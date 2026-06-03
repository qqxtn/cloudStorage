using System.Net;
using System.Diagnostics;
using System.Drawing;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.AspNetCore.WebUtilities;
using System.Windows.Forms;

var builder = WebApplication.CreateBuilder(args);
var listenUrl = Environment.GetEnvironmentVariable("CLOUD_STORAGE_URL") ?? "http://0.0.0.0:3107";
var browserUrl = BrowserUrl(listenUrl);
builder.WebHost.UseUrls(listenUrl);
var app = builder.Build();

var root = AppContext.BaseDirectory;
var uploadDir = Path.Combine(root, "uploads");
var dataFile = Path.Combine(root, "cloud-drive-data.json");
var publicSpace = "\u516c\u5171\u7a7a\u95f4";
var legacyDefaultSpace = "\u9ed8\u8ba4\u7a7a\u95f4";
Directory.CreateDirectory(uploadDir);

var adminSessions = new HashSet<string>();
var spaceSessions = new Dictionary<string, string>();
var jsonOptions = new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
jsonOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
string? firstRunPassword = null;

var store = LoadStore();
await MigrateDefaultSpaceAsync();
await ImportExistingSpacesAsync();
SaveStore();

Console.WriteLine("Admin credentials:");
Console.WriteLine($"  username: {store.Admin.Username}");
Console.WriteLine($"  password: {store.Admin.Password}");
Console.WriteLine($"Cloud storage is running at {listenUrl}");
Console.WriteLine($"Uploaded files are stored in {uploadDir}");

app.MapGet("/api/admin/status", (HttpRequest request) =>
{
    var admin = IsAdmin(request);
    return Results.Json(new { loggedIn = admin, username = admin ? store.Admin.Username : null }, jsonOptions);
});

app.MapPost("/api/admin/login", async (HttpRequest request) =>
{
    var body = await JsonSerializer.DeserializeAsync<LoginRequest>(request.Body, jsonOptions) ?? new();
    if (body.Username != store.Admin.Username || !VerifyPassword(body.Password, store.Admin.PasswordHash))
        return Results.Json(new { error = "Invalid admin credentials." }, statusCode: 401, options: jsonOptions);

    var token = Token();
    adminSessions.Add(token);
    return Results.Json(new { token, username = store.Admin.Username }, jsonOptions);
});

app.MapPost("/api/admin/logout", (HttpRequest request) =>
{
    var token = AdminToken(request);
    if (!string.IsNullOrWhiteSpace(token)) adminSessions.Remove(token);
    return Results.Json(new { loggedIn = false }, jsonOptions);
});

app.MapGet("/api/spaces", async (HttpRequest request) =>
{
    var spaces = await ListSpacesAsync(request);
    return Results.Json(new
    {
        spaces,
        defaultSpace = publicSpace,
        admin = new { loggedIn = IsAdmin(request), username = IsAdmin(request) ? store.Admin.Username : null }
    }, jsonOptions);
});

app.MapPost("/api/spaces", async (HttpRequest request) =>
{
    if (!IsAdmin(request)) return Results.Json(new { error = "Admin login required." }, statusCode: 401, options: jsonOptions);
    var body = await JsonSerializer.DeserializeAsync<CreateSpaceRequest>(request.Body, jsonOptions) ?? new();
    var name = SpaceName(body.Name);
    if (store.Spaces.ContainsKey(name)) return Results.Json(new { error = "Space already exists." }, statusCode: 409, options: jsonOptions);
    var visibility = body.Visibility == "private" ? "private" : "public";
    if (visibility == "private" && string.IsNullOrWhiteSpace(body.Password))
        return Results.Json(new { error = "Private space password is required." }, statusCode: 400, options: jsonOptions);

    store.Spaces[name] = new SpaceMeta
    {
        Name = name,
        Visibility = visibility,
        PasswordHash = visibility == "private" ? HashPassword(body.Password) : null,
        CreatedAt = DateTimeOffset.UtcNow
    };
    Directory.CreateDirectory(SpaceDir(name));
    SaveStore();
    return Results.Json(new { space = name, spaces = await ListSpacesAsync(request) }, jsonOptions);
});

app.MapDelete("/api/spaces", async (HttpRequest request) =>
{
    if (!IsAdmin(request)) return Results.Json(new { error = "Admin login required." }, statusCode: 401, options: jsonOptions);
    var name = SpaceName(request.Query["space"].FirstOrDefault());
    if (name == publicSpace) return Results.Json(new { error = "Public space cannot be deleted." }, statusCode: 400, options: jsonOptions);
    if (!store.Spaces.ContainsKey(name)) return Results.Json(new { error = "Space not found." }, statusCode: 404, options: jsonOptions);

    store.Spaces.Remove(name);
    SaveStore();
    var dir = SpaceDir(name);
    if (Directory.Exists(dir)) Directory.Delete(dir, true);
    return Results.Json(new { spaces = await ListSpacesAsync(request), defaultSpace = publicSpace }, jsonOptions);
});

app.MapPost("/api/spaces/login", async (HttpRequest request) =>
{
    var body = await JsonSerializer.DeserializeAsync<SpaceLoginRequest>(request.Body, jsonOptions) ?? new();
    var name = SpaceName(body.Name);
    if (!store.Spaces.TryGetValue(name, out var meta)) return Results.Json(new { error = "Space not found." }, statusCode: 404, options: jsonOptions);
    if (meta.Visibility == "public") return Results.Json(new { token = (string?)null, space = name }, jsonOptions);
    if (!VerifyPassword(body.Password, meta.PasswordHash)) return Results.Json(new { error = "Invalid space password." }, statusCode: 401, options: jsonOptions);

    var token = Token();
    spaceSessions[token] = name;
    return Results.Json(new { token, space = name }, jsonOptions);
});

app.MapGet("/api/files", async (HttpRequest request) =>
{
    var space = SpaceName(request.Query["space"].FirstOrDefault());
    if (!CanAccess(request, space)) return Results.Json(new { error = "Space password required." }, statusCode: 401, options: jsonOptions);
    return Results.Json(new { space, files = await ListFilesAsync(space) }, jsonOptions);
});

app.MapPost("/api/upload", async (HttpRequest request) =>
{
    var space = SpaceName(request.Query["space"].FirstOrDefault());
    if (!CanAccess(request, space)) return Results.Json(new { error = "Space password required." }, statusCode: 401, options: jsonOptions);
    var originalName = WebUtility.UrlDecode(request.Headers["x-file-name"].FirstOrDefault() ?? "file");
    var dir = SpaceDir(space);
    Directory.CreateDirectory(dir);
    var name = UniqueName(originalName, dir);
    var target = Path.Combine(dir, name);
    await using (var stream = File.Create(target))
    {
        await request.Body.CopyToAsync(stream);
    }
    var info = new FileInfo(target);
    return Results.Json(new
    {
        space,
        saved = new[] { new { name, size = info.Length } },
        spaces = await ListSpacesAsync(request),
        files = await ListFilesAsync(space)
    }, jsonOptions);
});

app.MapGet("/files", (HttpRequest request) =>
{
    var space = SpaceName(request.Query["space"].FirstOrDefault());
    if (!CanAccess(request, space)) return Results.Json(new { error = "Space password required." }, statusCode: 401, options: jsonOptions);
    var name = SafeFileName(request.Query["name"].FirstOrDefault() ?? "file");
    var file = Path.Combine(SpaceDir(space), name);
    if (!File.Exists(file)) return Results.Json(new { error = "File not found." }, statusCode: 404, options: jsonOptions);
    var provider = new FileExtensionContentTypeProvider();
    if (!provider.TryGetContentType(file, out var contentType)) contentType = "application/octet-stream";
    return Results.File(file, contentType);
});

app.MapDelete("/api/files", async (HttpRequest request) =>
{
    var space = SpaceName(request.Query["space"].FirstOrDefault());
    if (!CanAccess(request, space)) return Results.Json(new { error = "Space password required." }, statusCode: 401, options: jsonOptions);
    var name = SafeFileName(request.Query["name"].FirstOrDefault() ?? "file");
    var file = Path.Combine(SpaceDir(space), name);
    if (!File.Exists(file)) return Results.Json(new { error = "File not found." }, statusCode: 404, options: jsonOptions);
    File.Delete(file);
    return Results.Json(new { space, spaces = await ListSpacesAsync(request), files = await ListFilesAsync(space) }, jsonOptions);
});

app.MapGet("/{**resourcePath}", (string? resourcePath) =>
{
    var resource = string.IsNullOrWhiteSpace(resourcePath) ? "index.html" : resourcePath.TrimStart('/');
    var assembly = typeof(Program).Assembly;
    var resourceName = $"public/{resource.Replace('\\', '/')}";
    var stream = assembly.GetManifestResourceStream(resourceName);
    if (stream == null) return Results.NotFound();
    var provider = new FileExtensionContentTypeProvider();
    if (!provider.TryGetContentType(resourceName, out var contentType)) contentType = "application/octet-stream";
    return Results.Stream(stream, contentType);
});

var webTask = app.RunAsync();
var trayThread = new Thread(() => RunTrayApp(app, browserUrl, uploadDir, store.Admin.Username, store.Admin.Password, firstRunPassword is not null));
trayThread.SetApartmentState(ApartmentState.STA);
trayThread.Start();
await webTask;

Store LoadStore()
{
    if (!File.Exists(dataFile)) return CreateStore();
    try
    {
        var data = JsonSerializer.Deserialize<Store>(File.ReadAllText(dataFile, Encoding.UTF8), jsonOptions) ?? CreateStore();
        if (!data.Admin.PasswordHash.StartsWith("pbkdf2:", StringComparison.Ordinal) && !string.IsNullOrWhiteSpace(data.Admin.Password))
            data.Admin.PasswordHash = HashPassword(data.Admin.Password);
        data.Spaces ??= new();
        if (!data.Spaces.ContainsKey(publicSpace))
            data.Spaces[publicSpace] = new SpaceMeta { Name = publicSpace, Visibility = "public", CreatedAt = DateTimeOffset.UtcNow };
        return data;
    }
    catch
    {
        File.Move(dataFile, $"{dataFile}.broken-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}", true);
        return CreateStore();
    }
}

Store CreateStore()
{
    var password = Token(12);
    firstRunPassword = password;
    var data = new Store
    {
        Admin = new AdminConfig { Username = "admin", Password = password, PasswordHash = HashPassword(password) },
        Spaces = new()
        {
            [publicSpace] = new SpaceMeta { Name = publicSpace, Visibility = "public", CreatedAt = DateTimeOffset.UtcNow }
        }
    };
    File.WriteAllText(dataFile, JsonSerializer.Serialize(data, jsonOptions), Encoding.UTF8);
    return data;
}

void SaveStore() => File.WriteAllText(dataFile, JsonSerializer.Serialize(store, jsonOptions), Encoding.UTF8);

async Task MigrateDefaultSpaceAsync()
{
    var legacy = Path.Combine(uploadDir, legacyDefaultSpace);
    var target = SpaceDir(publicSpace);
    Directory.CreateDirectory(target);
    if (!Directory.Exists(legacy) || string.Equals(legacy, target, StringComparison.OrdinalIgnoreCase)) return;
    foreach (var file in Directory.GetFiles(legacy))
    {
        File.Move(file, Path.Combine(target, UniqueName(Path.GetFileName(file), target)));
    }
    Directory.Delete(legacy, true);
    await Task.CompletedTask;
}

async Task ImportExistingSpacesAsync()
{
    Directory.CreateDirectory(uploadDir);
    foreach (var dir in Directory.GetDirectories(uploadDir))
    {
        var name = SpaceName(Path.GetFileName(dir));
        if (!store.Spaces.ContainsKey(name))
            store.Spaces[name] = new SpaceMeta { Name = name, Visibility = "public", CreatedAt = DateTimeOffset.UtcNow };
    }
    SaveStore();
    await Task.CompletedTask;
}

async Task<List<SpaceDto>> ListSpacesAsync(HttpRequest request)
{
    var result = new List<SpaceDto>();
    foreach (var space in store.Spaces.Values)
    {
        Directory.CreateDirectory(SpaceDir(space.Name));
        var files = await ListFilesAsync(space.Name);
        result.Add(new SpaceDto(
            space.Name,
            space.Visibility,
            space.Visibility == "private",
            space.Visibility == "public" || IsUnlocked(request, space.Name),
            files.Count,
            files.Sum(file => file.Size),
            space.CreatedAt));
    }
    return result
        .OrderBy(space => space.Name == publicSpace ? 0 : 1)
        .ThenBy(space => space.Name)
        .ToList();
}

async Task<List<FileDto>> ListFilesAsync(string space)
{
    var dir = SpaceDir(space);
    Directory.CreateDirectory(dir);
    return await Task.FromResult(Directory.GetFiles(dir)
        .Select(file => new FileInfo(file))
        .OrderByDescending(file => file.LastWriteTimeUtc)
        .Select(file => new FileDto(file.Name, file.Length, file.LastWriteTimeUtc.ToString("O"),
            Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes($"{space}/{file.Name}"))).ToLowerInvariant()))
        .ToList());
}

bool CanAccess(HttpRequest request, string space)
{
    if (!store.Spaces.TryGetValue(space, out var meta)) return false;
    return meta.Visibility == "public" || IsUnlocked(request, space);
}

bool IsUnlocked(HttpRequest request, string space)
{
    if (IsAdmin(request)) return true;
    var token = request.Headers["x-space-token"].FirstOrDefault() ?? request.Query["token"].FirstOrDefault();
    return !string.IsNullOrWhiteSpace(token) && spaceSessions.TryGetValue(token, out var unlocked) && unlocked == space;
}

bool IsAdmin(HttpRequest request)
{
    var token = request.Headers["x-admin-token"].FirstOrDefault() ?? request.Query["adminToken"].FirstOrDefault();
    return !string.IsNullOrWhiteSpace(token) && adminSessions.Contains(token);
}

string AdminToken(HttpRequest request) => request.Headers["x-admin-token"].FirstOrDefault() ?? request.Query["adminToken"].FirstOrDefault() ?? "";

string SpaceName(string? value)
{
    var name = SafeFileName(string.IsNullOrWhiteSpace(value) ? publicSpace : value);
    return name == legacyDefaultSpace ? publicSpace : name;
}

string SpaceDir(string space) => Path.Combine(uploadDir, SpaceName(space));

string SafeFileName(string value)
{
    var invalid = Path.GetInvalidFileNameChars();
    var cleaned = new string(value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray()).Trim();
    return string.IsNullOrWhiteSpace(cleaned) ? "file" : cleaned;
}

string UniqueName(string originalName, string dir)
{
    var safe = SafeFileName(originalName);
    var ext = Path.GetExtension(safe);
    var name = Path.GetFileNameWithoutExtension(safe);
    var candidate = safe;
    var counter = 1;
    while (File.Exists(Path.Combine(dir, candidate)))
    {
        candidate = $"{name}-{counter}{ext}";
        counter += 1;
    }
    return candidate;
}

string Token(int bytes = 24) => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(bytes));

string HashPassword(string? password)
{
    var salt = RandomNumberGenerator.GetBytes(16);
    var hash = Rfc2898DeriveBytes.Pbkdf2(password ?? "", salt, 100_000, HashAlgorithmName.SHA256, 32);
    return $"pbkdf2:{Convert.ToHexString(salt)}:{Convert.ToHexString(hash)}";
}

bool VerifyPassword(string? password, string? stored)
{
    if (string.IsNullOrWhiteSpace(stored)) return false;
    var parts = stored.Split(':');
    if (parts.Length != 3 || parts[0] != "pbkdf2") return false;
    var salt = Convert.FromHexString(parts[1]);
    var expected = Convert.FromHexString(parts[2]);
    var actual = Rfc2898DeriveBytes.Pbkdf2(password ?? "", salt, 100_000, HashAlgorithmName.SHA256, 32);
    return CryptographicOperations.FixedTimeEquals(actual, expected);
}

string BrowserUrl(string url)
{
    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return "http://127.0.0.1:3107";
    var host = uri.Host is "0.0.0.0" or "::" or "+" or "*" ? "127.0.0.1" : uri.Host;
    var builder = new UriBuilder(uri) { Host = host };
    return builder.Uri.ToString().TrimEnd('/');
}

void RunTrayApp(WebApplication webApp, string url, string filesDir, string username, string password, bool showFirstRunCredentials)
{
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);

    using var icon = LoadAppIcon();
    using var tray = new NotifyIcon
    {
        Icon = icon,
        Text = "本地网盘",
        Visible = true,
        ContextMenuStrip = new ContextMenuStrip()
    };

    tray.ContextMenuStrip.Items.Add("打开网盘", null, (_, _) => OpenPath(url));
    tray.ContextMenuStrip.Items.Add("复制管理员密码", null, (_, _) => CopyAdminCredentials(username, password));
    tray.ContextMenuStrip.Items.Add("打开上传目录", null, (_, _) => OpenPath(filesDir));
    tray.ContextMenuStrip.Items.Add(new ToolStripSeparator());
    tray.ContextMenuStrip.Items.Add("退出", null, async (_, _) =>
    {
        tray.Visible = false;
        await webApp.StopAsync();
        Application.Exit();
    });
    tray.DoubleClick += (_, _) => OpenPath(url);

    if (showFirstRunCredentials)
    {
        tray.ShowBalloonTip(5000, "本地网盘已启动", "首次启动已生成管理员密码，可在弹窗或托盘菜单中复制。", ToolTipIcon.Info);
        using var form = CreateCredentialsForm(icon, username, password, url);
        form.ShowDialog();
    }
    else
    {
        tray.ShowBalloonTip(3000, "本地网盘已启动", "双击托盘图标打开网盘。", ToolTipIcon.Info);
    }

    Application.Run();
}

Icon LoadAppIcon()
{
    return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
}

Form CreateCredentialsForm(Icon icon, string username, string password, string url)
{
    var form = new Form
    {
        Text = "本地网盘管理员密码",
        Icon = icon,
        Width = 460,
        Height = 260,
        StartPosition = FormStartPosition.CenterScreen,
        FormBorderStyle = FormBorderStyle.FixedDialog,
        MaximizeBox = false,
        MinimizeBox = false
    };

    var title = new Label
    {
        Text = "首次启动已生成管理员账号",
        Left = 24,
        Top = 20,
        Width = 390,
        Height = 28,
        Font = new Font("Microsoft YaHei UI", 12, FontStyle.Bold)
    };
    var userLabel = new Label { Text = "用户名", Left = 24, Top = 66, Width = 72, Height = 24 };
    var userBox = new TextBox { Left = 100, Top = 62, Width = 300, ReadOnly = true, Text = username };
    var passLabel = new Label { Text = "密码", Left = 24, Top = 106, Width = 72, Height = 24 };
    var passBox = new TextBox { Left = 100, Top = 102, Width = 300, ReadOnly = true, Text = password };
    var copyButton = new Button { Text = "复制账号密码", Left = 100, Top = 150, Width = 140, Height = 34 };
    var openButton = new Button { Text = "打开网盘", Left = 260, Top = 150, Width = 140, Height = 34 };
    var hint = new Label { Text = "以后也可以右键右下角托盘图标复制管理员密码。", Left = 24, Top = 198, Width = 390, Height = 24 };

    copyButton.Click += (_, _) => CopyAdminCredentials(username, password);
    openButton.Click += (_, _) => OpenPath(url);

    form.Controls.AddRange(new Control[] { title, userLabel, userBox, passLabel, passBox, copyButton, openButton, hint });
    return form;
}

void CopyAdminCredentials(string username, string password)
{
    Clipboard.SetText($"username: {username}{Environment.NewLine}password: {password}");
}

void OpenPath(string target)
{
    Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
}

public record LoginRequest(string? Username = null, string? Password = null);
public record CreateSpaceRequest(string? Name = null, string? Visibility = null, string? Password = null);
public record SpaceLoginRequest(string? Name = null, string? Password = null);
public record SpaceDto(string Name, string Visibility, bool Locked, bool Unlocked, int FileCount, long TotalSize, DateTimeOffset CreatedAt);
public record FileDto(string Name, long Size, string ModifiedAt, string Id);
public class Store
{
    public AdminConfig Admin { get; set; } = new();
    public Dictionary<string, SpaceMeta> Spaces { get; set; } = new();
}
public class AdminConfig
{
    public string Username { get; set; } = "admin";
    public string Password { get; set; } = "";
    public string PasswordHash { get; set; } = "";
}
public class SpaceMeta
{
    public string Name { get; set; } = "";
    public string Visibility { get; set; } = "public";
    public string? PasswordHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

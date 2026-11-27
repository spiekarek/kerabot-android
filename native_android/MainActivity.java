package pl.seba.kerabot;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.AtomicFile;
import android.util.Base64;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.UUID;

public class MainActivity extends BridgeActivity {
    public static final String CHANNEL_ID = "AI_HUB_PILNE";
    private static final int MAX_BACKUP_BYTES = 16 * 1024 * 1024;
    private static final String LOCAL_SHELL_ORIGIN = "https://localhost";
    private static final String KERABOT_BASE_URL = "https://kordian.s-piekarek.workers.dev/next";
    private static final Object SHARE_QUEUE_LOCK = new Object();

    private WebView kerabotWebView;
    private boolean showingRemoteKeraBot = false;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private ActivityResultLauncher<String> createOfflineBackup;
    private ActivityResultLauncher<String[]> openOfflineBackup;
    // Wszystkie wywołania tego stanu odbywają się na głównym wątku, także po odtworzeniu Activity.
    private static boolean offlineBackupInProgress;
    private JavaScriptReplyProxy offlineBackupReply;
    private JavaScriptReplyProxy offlineRestoreReply;
    private Button[] navButtons = new Button[5];

    @Override
    public void onCreate(Bundle savedInstanceState) {
        openOfflineBackup = registerForActivityResult(
                new ActivityResultContracts.OpenDocument(), this::readOfflineBackup);
        createOfflineBackup = registerForActivityResult(
                new ActivityResultContracts.CreateDocument("application/json"),
                this::writeOfflineBackup
        );
        fileChooserLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    if (filePathCallback == null) return;
                    Uri[] results = null;
                    if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                        String dataString = result.getData().getDataString();
                        if (dataString != null) {
                            results = new Uri[]{Uri.parse(dataString)};
                        } else if (result.getData().getClipData() != null) {
                            int count = result.getData().getClipData().getItemCount();
                            results = new Uri[count];
                            for (int i = 0; i < count; i++) {
                                results[i] = result.getData().getClipData().getItemAt(i).getUri();
                            }
                        }
                    }
                    filePathCallback.onReceiveValue(results);
                    filePathCallback = null;
                }
        );

        super.onCreate(savedInstanceState);
        createUrgentNotificationChannel();
        requestRuntimePermissions();

        WebView localWebView = getBridge().getWebView();
        if (localWebView != null) {
            configurePersistentWebView(localWebView);
            registerOfflineBackup(localWebView);
            localWebView.addJavascriptInterface(new SebaAndroidBridge(this), "SebaAndroidBridge");
            localWebView.addJavascriptInterface(new PendingShareBridge(), "SebaPendingShare");
            setupDualWebViewShell(localWebView);
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (showingRemoteKeraBot && kerabotWebView != null && kerabotWebView.canGoBack()) {
                    kerabotWebView.goBack();
                } else if (showingRemoteKeraBot) {
                    switchToLocalTab("updates", 4);
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        // Sprawdz czy aplikacja zostala otwarta przez Android "Udostepnij -> KeraBot AI HUB"
        boolean handledShare = savedInstanceState == null && handleIncomingShareIntent(getIntent(), true);
        if (!handledShare && oldestPendingShare() != null) {
            switchToLocalTab("offline", 3);
            deliverPendingShareToJs();
            handledShare = true;
        }
        if (!handledShare) {
            if (checkOnlineStatus()) {
                openRemoteKeraBot(KERABOT_BASE_URL + "#pokoj", 0, false);
            } else {
                switchToLocalTab("offline", 3);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingShareIntent(intent, false);
    }

    private boolean handleIncomingShareIntent(Intent intent, boolean onLaunch) {
        if (intent == null) return false;
        String action = intent.getAction();
        String type = intent.getType();
        if (action == null || type == null) return false;

        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return false;
        }

        try {
            JSONArray items = new JSONArray();
            int expected = 1;
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            String sharedSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);

            if (Intent.ACTION_SEND.equals(action) && type.startsWith("text/")) {
                JSONObject obj = new JSONObject();
                obj.put("text", (sharedSubject != null && !sharedSubject.isEmpty() ? sharedSubject + "\n" : "") + (sharedText != null ? sharedText : ""));
                obj.put("source", "Udostępnij (Android)");
                obj.put("category", "inne");
                items.put(obj);
            } else if (Intent.ACTION_SEND.equals(action) && type.startsWith("image/")) {
                Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (uri != null) {
                    String dataUrl = readScaledImageDataUrl(uri, 960);
                    if (dataUrl != null) {
                        JSONObject obj = new JSONObject();
                        obj.put("text", sharedText != null && !sharedText.isEmpty() ? sharedText : "Zrzut / zdjęcie udostępnione z telefonu");
                        obj.put("photo", dataUrl);
                        obj.put("source", "Udostępnij (Galeria)");
                        obj.put("category", "zrzut");
                        items.put(obj);
                    }
                }
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action) && type.startsWith("image/")) {
                ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (uris != null) {
                    expected = uris.size();
                    int maxCount = Math.min(uris.size(), 10);
                    for (int i = 0; i < maxCount; i++) {
                        String dataUrl = readScaledImageDataUrl(uris.get(i), 800);
                        if (dataUrl != null) {
                            JSONObject obj = new JSONObject();
                            obj.put("text", "Zrzut " + (i + 1) + "/" + maxCount + (sharedText != null && !sharedText.isEmpty() ? " — " + sharedText : " z Galerii telefonu"));
                            obj.put("photo", dataUrl);
                            obj.put("source", "Udostępnij (Seria " + maxCount + " szt.)");
                            obj.put("category", "zrzut");
                            items.put(obj);
                        }
                    }
                }
            }

            if (items.length() > 0) {
                storePendingShare(items, onLaunch);
                if (items.length() < expected) {
                    Toast.makeText(this, "Odebrano " + items.length() + " z " + expected
                            + " plików. Udostępnij pozostałe osobno.", Toast.LENGTH_LONG).show();
                }
                switchToLocalTab("offline", 3);
                deliverPendingShareToJs();
                return true;
            }
            Toast.makeText(this, "Nie udało się odczytać udostępnionych plików.", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Log.w("KeraBot", "Zapis odebranej paczki nie powiódł się", error);
            Toast.makeText(this, "Brak zapisu w Inboxie. Udostępnij pliki ponownie.", Toast.LENGTH_LONG).show();
        }
        return false;
    }

    private File shareQueueDirectory() {
        return new File(getNoBackupFilesDir(), "pending-shares");
    }

    private File oldestPendingShare() {
        synchronized (SHARE_QUEUE_LOCK) {
            File[] batches = shareQueueDirectory().listFiles((directory, name) -> name.endsWith(".json"));
            if (batches == null || batches.length == 0) return null;
            Arrays.sort(batches);
            return batches[0];
        }
    }

    private void storePendingShare(JSONArray items, boolean onLaunch) throws Exception {
        synchronized (SHARE_QUEUE_LOCK) {
            File directory = shareQueueDirectory();
            if (!directory.isDirectory() && !directory.mkdirs()) {
                throw new IOException("Nie można utworzyć kolejki odbioru");
            }
            byte[] data = items.toString().getBytes(StandardCharsets.UTF_8);
            String fingerprint = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(data),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            String suffix = "-" + fingerprint + ".json";
            if (onLaunch) {
                // Android może wznowić to samo udostępnienie po awarii renderera.
                String[] pending = directory.list((parent, name) -> name.endsWith(suffix));
                if (pending == null) throw new IOException("Nie można odczytać kolejki odbioru");
                if (pending.length > 0) return;
            }
            String batchId = System.currentTimeMillis() + "-" + UUID.randomUUID() + "-" + fingerprint;
            JSONObject batch = new JSONObject();
            batch.put("id", batchId);
            batch.put("items", items);
            AtomicFile file = new AtomicFile(new File(directory, batchId + ".json"));
            FileOutputStream output = file.startWrite();
            try {
                output.write(batch.toString().getBytes(StandardCharsets.UTF_8));
                file.finishWrite(output);
            } catch (IOException error) {
                file.failWrite(output);
                throw error;
            }
            if (!file.getBaseFile().isFile()) throw new IOException("Nie zapisano paczki");
        }
    }

    public class PendingShareBridge {
        @JavascriptInterface
        public String peek() {
            synchronized (SHARE_QUEUE_LOCK) {
                File pending = oldestPendingShare();
                if (pending == null) return "";
                try {
                    return new String(new AtomicFile(pending).readFully(), StandardCharsets.UTF_8);
                } catch (IOException error) {
                    Log.w("KeraBot", "Odczyt paczki nie powiódł się", error);
                    return "{}";
                }
            }
        }

        @JavascriptInterface
        public boolean acknowledge(String batchId) {
            synchronized (SHARE_QUEUE_LOCK) {
                File pending = oldestPendingShare();
                if (pending == null || !pending.getName().equals(batchId + ".json")) return false;
                new AtomicFile(pending).delete();
                return !pending.exists();
            }
        }
    }

    private void deliverPendingShareToJs() {
        runOnUiThread(() -> {
            WebView localWv = getBridge().getWebView();
            if (localWv == null) return;
            localWv.postDelayed(() -> {
                localWv.evaluateJavascript("if(window.SebaConsumePendingShare){window.SebaConsumePendingShare();}", null);
            }, 650);
        });
    }

    private String readScaledImageDataUrl(Uri uri, int maxDim) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream is1 = getContentResolver().openInputStream(uri)) {
                if (is1 == null) return null;
                BitmapFactory.decodeStream(is1, null, bounds);
            }
            int sample = 1;
            int longest = Math.max(bounds.outWidth, bounds.outHeight);
            while (longest / sample > maxDim * 2) {
                sample *= 2;
            }
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            Bitmap bmp;
            try (InputStream is2 = getContentResolver().openInputStream(uri)) {
                if (is2 == null) return null;
                bmp = BitmapFactory.decodeStream(is2, null, opts);
            }
            if (bmp == null) return null;

            int w = bmp.getWidth();
            int h = bmp.getHeight();
            if (w > maxDim || h > maxDim) {
                float scale = Math.min((float) maxDim / w, (float) maxDim / h);
                Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), true);
                if (scaled != bmp) bmp.recycle();
                bmp = scaled;
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 80, baos);
            bmp.recycle();
            String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            return "data:image/jpeg;base64," + b64;
        } catch (Exception e) {
            return null;
        }
    }

    private void registerOfflineBackup(WebView localWebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(localWebView, "SebaOfflineBackup",
                Collections.singleton(LOCAL_SHELL_ORIGIN), (view, message, origin, isMainFrame, reply) -> {
                    if (!isMainFrame || !LOCAL_SHELL_ORIGIN.equals(origin.toString())) return;
                    String json = message.getData();
                    if (offlineBackupInProgress || json == null || json.length() > MAX_BACKUP_BYTES) {
                        reply.postMessage("error");
                        return;
                    }
                    if ("open".equals(json)) {
                        offlineBackupInProgress = true;
                        offlineRestoreReply = reply;
                        try {
                            openOfflineBackup.launch(new String[]{"application/json", "application/octet-stream", "text/plain"});
                        } catch (RuntimeException error) {
                            finishOfflineRestore("error");
                        }
                        return;
                    }
                    byte[] data = json.getBytes(StandardCharsets.UTF_8);
                    if (data.length > MAX_BACKUP_BYTES) {
                        reply.postMessage("error");
                        return;
                    }
                    offlineBackupInProgress = true;
                    offlineBackupReply = reply;
                    try {
                        stageOfflineBackup(data);
                        createOfflineBackup.launch("kerabot-kolejka.json");
                    } catch (IOException | RuntimeException error) {
                        finishOfflineBackup("error");
                    }
                });
    }

    private AtomicFile offlineBackupFile() {
        return new AtomicFile(new File(getNoBackupFilesDir(), "kerabot-kolejka-tymczasowa.json"));
    }

    private void stageOfflineBackup(byte[] data) throws IOException {
        AtomicFile file = offlineBackupFile();
        FileOutputStream stream = file.startWrite();
        try {
            stream.write(data);
            file.finishWrite(stream);
        } catch (IOException | RuntimeException error) {
            file.failWrite(stream);
            throw error;
        }
    }

    private void writeOfflineBackup(Uri destination) {
        if (destination == null) {
            finishOfflineBackup("cancelled");
            return;
        }
        offlineBackupInProgress = true;
        new Thread(() -> {
            String result = "error";
            try (FileInputStream input = offlineBackupFile().openRead();
                 OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new IOException();
                byte[] buffer = new byte[8192];
                for (int size; (size = input.read(buffer)) != -1;) output.write(buffer, 0, size);
                result = "ok";
            } catch (IOException | RuntimeException error) {
                result = "error";
            }
            String status = result;
            runOnUiThread(() -> finishOfflineBackup(status));
        }, "kerabot-offline-backup").start();
    }

    private void finishOfflineBackup(String status) {
        offlineBackupFile().delete();
        JavaScriptReplyProxy reply = offlineBackupReply;
        offlineBackupInProgress = false;
        offlineBackupReply = null;
        if (reply != null && !isDestroyed()) {
            reply.postMessage(status);
        } else {
            String message = "Android nie zapisał kopii kolejki.";
            if ("ok".equals(status)) message = "Kopia kolejki zapisana.";
            if ("cancelled".equals(status)) message = "Anulowano zapis kopii kolejki.";
            Toast.makeText(getApplicationContext(), message, Toast.LENGTH_LONG).show();
        }
    }

    private void readOfflineBackup(Uri selected) {
        if (selected == null) {
            finishOfflineRestore("cancelled");
            return;
        }
        offlineBackupInProgress = true;
        new Thread(() -> {
            String result;
            try (InputStream input = getContentResolver().openInputStream(selected);
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input == null) throw new IOException();
                byte[] buffer = new byte[8192];
                for (int size; (size = input.read(buffer)) != -1;) {
                    if (output.size() + size > MAX_BACKUP_BYTES) throw new IOException();
                    output.write(buffer, 0, size);
                }
                result = "import:" + new String(output.toByteArray(), StandardCharsets.UTF_8);
            } catch (IOException | RuntimeException error) {
                result = "error";
            }
            String status = result;
            runOnUiThread(() -> finishOfflineRestore(status));
        }, "kerabot-offline-restore").start();
    }

    private void finishOfflineRestore(String status) {
        JavaScriptReplyProxy reply = offlineRestoreReply;
        offlineRestoreReply = null;
        offlineBackupInProgress = false;
        if (reply != null && !isDestroyed()) {
            reply.postMessage(status);
        } else if (!"cancelled".equals(status)) {
            Toast.makeText(getApplicationContext(), "Otwórz ponownie plik kopii.", Toast.LENGTH_LONG).show();
        }
    }

    private void launchExternalUrl(String url) {
        if (url == null || url.isEmpty()) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    private void configurePersistentWebView(WebView wv) {
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(wv, true);

        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        // Usuniecie znacznika "; wv", aby Cloudflare Access i logowanie dzialaly jak w pelnym Chrome Mobile
        String ua = s.getUserAgentString();
        if (ua != null) {
            String cleanUa = ua.replace("; wv", "").replace("Version/4.0 ", "");
            s.setUserAgentString(cleanUa);
        }

        // Obsluga pobierania plikow (w tym .apk aktualizacji!) przez systemowy menedzer Androida
        wv.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                launchExternalUrl(url);
            }
        });
    }

    private void injectPolishCloudflareHelper(WebView view, String url) {
        if (url == null || !url.contains("cloudflareaccess.com")) return;
        String js = "(function(){" +
                "if(document.getElementById('seba-cf-pl-bar'))return;" +
                "var d=document.createElement('div');" +
                "d.id='seba-cf-pl-bar';" +
                "d.style.cssText='background:linear-gradient(135deg,#2e1065,#581c87);color:#f5f3ff;padding:12px 14px;font-family:system-ui,sans-serif;font-size:13.5px;line-height:1.45;border-bottom:2px solid #a855f7;z-index:99999;position:relative;';" +
                "d.innerHTML='<strong>🔐 Logowanie Cloudflare Access (jednorazowe w aplikacji):</strong><br>1. Wpisz poniżej swój e-mail i kliknij niebieski przycisk <b>Send login code</b> (lub kliknij <b>Cloudflare</b> wyżej).<br>2. Odbierz 6-cyfrowy kod z maila i wpisz go tutaj — aplikacja trwale zapamięta sesję!';" +
                "if(document.body)document.body.insertBefore(d,document.body.firstChild);" +
                "})();";
        view.evaluateJavascript(js, null);
    }

    private void setupDualWebViewShell(WebView localWebView) {
        ViewGroup parent = (ViewGroup) localWebView.getParent();
        if (parent == null) return;
        int index = parent.indexOfChild(localWebView);
        ViewGroup.LayoutParams origParams = localWebView.getLayoutParams();
        parent.removeView(localWebView);

        // Glowny kontener pionowy: gora = FrameLayout (oba WebView), dol = natywny pasek przelaczania
        LinearLayout rootColumn = new LinearLayout(this);
        rootColumn.setOrientation(LinearLayout.VERTICAL);
        rootColumn.setBackgroundColor(Color.parseColor("#0B0718"));
        rootColumn.setLayoutParams(origParams != null ? origParams : new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        FrameLayout webContainer = new FrameLayout(this);
        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        webContainer.setLayoutParams(webParams);

        localWebView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webContainer.addView(localWebView);

        // Drugi top-level WebView dla KeraBota i Cloudflare Access (ZERO iframe, ZERO ERR_BLOCKED_BY_RESPONSE!)
        kerabotWebView = new WebView(this);
        kerabotWebView.setBackgroundColor(Color.parseColor("#0B0718"));
        kerabotWebView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        configurePersistentWebView(kerabotWebView);
        kerabotWebView.addJavascriptInterface(new SebaAndroidBridge(this), "SebaAndroidBridge");

        kerabotWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String urlStr = uri.toString();
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                if (urlStr.endsWith(".apk")) {
                    launchExternalUrl(urlStr);
                    return true;
                }
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    return false;
                }
                launchExternalUrl(urlStr);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                injectPolishCloudflareHelper(view, url);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame() && !checkOnlineStatus()) {
                    runOnUiThread(() -> switchToLocalTab("offline", 3));
                }
            }
        });

        kerabotWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCb, FileChooserParams fileChooserParams) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = filePathCb;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    fileChooserLauncher.launch(intent);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        kerabotWebView.setVisibility(View.GONE);
        webContainer.addView(kerabotWebView);

        View divider = new View(this);
        divider.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        divider.setBackgroundColor(Color.parseColor("#4C1D95"));

        // Natywny dolny pasek nawigacji
        LinearLayout bottomBar = new LinearLayout(this);
        bottomBar.setOrientation(LinearLayout.HORIZONTAL);
        bottomBar.setBackgroundColor(Color.parseColor("#130D26"));
        bottomBar.setGravity(Gravity.CENTER);
        bottomBar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        String[] labels = new String[]{"💬 Pokój", "🧭 Live", "🎮 Gry", "📥 Inbox", "🚀 Apka"};
        for (int i = 0; i < labels.length; i++) {
            final int idx = i;
            Button b = new Button(this);
            b.setText(labels[i]);
            b.setAllCaps(false);
            b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
            b.setTypeface(Typeface.DEFAULT_BOLD);
            b.setPadding(dp(2), dp(4), dp(2), dp(4));
            b.setBackgroundColor(Color.TRANSPARENT);
            b.setTextColor(Color.parseColor("#A79BC8"));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f);
            b.setLayoutParams(lp);
            b.setOnClickListener(v -> {
                if (idx == 0) openRemoteKeraBot(KERABOT_BASE_URL + "#pokoj", 0, false);
                else if (idx == 1) openRemoteKeraBot(KERABOT_BASE_URL + "#sebalive", 1, false);
                else if (idx == 2) openRemoteKeraBot(KERABOT_BASE_URL + "#sebagames", 2, false);
                else if (idx == 3) switchToLocalTab("offline", 3);
                else switchToLocalTab("updates", 4);
            });
            navButtons[i] = b;
            bottomBar.addView(b);
        }

        rootColumn.addView(webContainer);
        rootColumn.addView(divider);
        rootColumn.addView(bottomBar);
        parent.addView(rootColumn, index);
    }

    private void highlightNav(int activeIdx) {
        for (int i = 0; i < navButtons.length; i++) {
            if (navButtons[i] == null) continue;
            if (i == activeIdx) {
                navButtons[i].setTextColor(Color.parseColor("#F5F3FF"));
                navButtons[i].setBackgroundColor(Color.parseColor("#3B1C71"));
            } else {
                navButtons[i].setTextColor(Color.parseColor("#A79BC8"));
                navButtons[i].setBackgroundColor(Color.TRANSPARENT);
            }
        }
    }

    public void openRemoteKeraBot(final String targetUrl, final int navIdx, final boolean forceReload) {
        runOnUiThread(() -> {
            if (!checkOnlineStatus()) {
                switchToLocalTab("offline", 3);
                return;
            }
            if (kerabotWebView == null) return;
            showingRemoteKeraBot = true;
            kerabotWebView.setVisibility(View.VISIBLE);
            String cur = kerabotWebView.getUrl();
            if (forceReload || cur == null || cur.isEmpty() || "about:blank".equals(cur)) {
                kerabotWebView.loadUrl(targetUrl);
            } else if (cur.contains("cloudflareaccess.com")) {
                // Zachowaj formularz 6-cyfrowego kodu PIN przy powrocie z Gmaila!
            } else if (cur.startsWith(KERABOT_BASE_URL)) {
                int hashPos = targetUrl.indexOf('#');
                if (hashPos >= 0) {
                    String hash = targetUrl.substring(hashPos);
                    kerabotWebView.evaluateJavascript("window.location.hash = '" + hash + "';", null);
                } else {
                    kerabotWebView.loadUrl(targetUrl);
                }
            } else {
                kerabotWebView.loadUrl(targetUrl);
            }
            highlightNav(navIdx);
        });
    }

    public void switchToLocalTab(final String tabId, final int navIdx) {
        runOnUiThread(() -> {
            showingRemoteKeraBot = false;
            if (kerabotWebView != null) {
                kerabotWebView.setVisibility(View.GONE);
            }
            WebView localWv = getBridge().getWebView();
            if (localWv != null) {
                localWv.evaluateJavascript("if(window.SebaSwitchLocalTab) window.SebaSwitchLocalTab('" + tabId + "');", null);
            }
            highlightNav(navIdx);
        });
    }

    private int dp(int val) {
        return Math.round(val * getResources().getDisplayMetrics().density);
    }

    private boolean checkOnlineStatus() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            NetworkInfo active = cm.getActiveNetworkInfo();
            return active != null && active.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    public void onStop() {
        super.onStop();
        CookieManager.getInstance().flush();
    }

    private void createUrgentNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            CharSequence name = "AI HUB PILNE (Alarmy Sebastiana)";
            String description = "Priorytetowy kanal powiadomien od Wiktora, KeraBota i AI HUB.";
            int importance = NotificationManager.IMPORTANCE_HIGH;
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, name, importance);
            channel.setDescription(description);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 600});

            Uri alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .build();
            channel.setSound(alarmSound, audioAttrs);

            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void requestRuntimePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{
                        Manifest.permission.POST_NOTIFICATIONS,
                        Manifest.permission.RECORD_AUDIO
                }, 1001);
                return;
            }
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, 1002);
        }
    }

    public class SebaAndroidBridge {
        private final Context context;

        SebaAndroidBridge(Context ctx) {
            this.context = ctx;
        }

        @JavascriptInterface
        public String getDeviceInfo() {
            return Build.MANUFACTURER + " " + Build.MODEL + " (Android " + Build.VERSION.RELEASE + ")";
        }

        @JavascriptInterface
        public boolean isOnline() {
            return checkOnlineStatus();
        }

        @JavascriptInterface
        public void openKeraBotUrl(String url) {
            openRemoteKeraBot(url != null ? url : (KERABOT_BASE_URL + "#pokoj"), 0, false);
        }

        @JavascriptInterface
        public void forceReloadKeraBot(String url) {
            openRemoteKeraBot(url != null ? url : (KERABOT_BASE_URL + "#pokoj"), 0, true);
        }

        @JavascriptInterface
        public void openExternalUrl(String url) {
            launchExternalUrl(url);
        }

        @JavascriptInterface
        public void flushCookiesNow() {
            CookieManager.getInstance().flush();
        }

        @JavascriptInterface
        public void openNotificationChannelSettings() {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
                intent.putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID);
            } else {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra("app_package", context.getPackageName());
                intent.putExtra("app_uid", context.getApplicationInfo().uid);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        }

        @JavascriptInterface
        public void openSoundSettings() {
            Intent intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        }

        @JavascriptInterface
        public void openAccessibilitySettings() {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        }

        @JavascriptInterface
        public void sendUrgentNotification(String title, String body) {
            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_alert)
                    .setContentTitle(title != null ? title : "AI HUB PILNE")
                    .setContentText(body != null ? body : "Wymagana Twoja uwaga w KeraBocie.")
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setVibrate(new long[]{0, 400, 200, 400})
                    .setAutoCancel(true);

            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify((int) (System.currentTimeMillis() % 100000), builder.build());
            }
        }
    }
}

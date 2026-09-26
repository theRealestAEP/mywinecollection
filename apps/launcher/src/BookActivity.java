package io.github.therealestaep.wineportraits;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Shows the book full screen, and keeps the screen awake. The first time the
// app opens, it asks for the link to the book, with its key: from a file that
// holds the link, or pasted. To change the link later, clear the app's storage
// in Android's settings.
public class BookActivity extends Activity {
    private static final String LINK = "link";
    private static final int CHOOSE_FILE = 1;
    private WebView book;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        String link = getPreferences(MODE_PRIVATE).getString(LINK, null);
        if (link == null) askForLink();
        else showBook(link);
    }

    private void askForLink() {
        TextView prompt = new TextView(this);
        prompt.setText("Which book should this screen show? Choose a file that holds the link to your book, such as Wine Portraits.html in Downloads. Or paste the link below. For an e-ink screen, the link ends with &eink.");
        prompt.setTextSize(22);
        Button choose = new Button(this);
        choose.setText("Choose the link file");
        choose.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                startActivityForResult(intent, CHOOSE_FILE);
            }
        });
        EditText field = new EditText(this);
        field.setHint("https://…/?key=…&eink");
        field.setSingleLine();
        Button open = new Button(this);
        open.setText("Open the book");
        open.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                String link = field.getText().toString().trim();
                if (!link.startsWith("https://")) {
                    field.setError("The link starts with https://");
                    return;
                }
                keep(link);
            }
        });
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(64, 160, 64, 64);
        form.addView(prompt);
        form.addView(choose);
        form.addView(field);
        form.addView(open);
        setContentView(form);
    }

    private void keep(String link) {
        getPreferences(MODE_PRIVATE).edit().putString(LINK, link).apply();
        showBook(link);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request != CHOOSE_FILE || result != RESULT_OK || data == null) return;
        String link = linkIn(data.getData());
        if (link == null) Toast.makeText(this, "That file holds no link to a book.", Toast.LENGTH_LONG).show();
        else keep(link);
    }

    // The first link with a key in a file, such as the Wine Portraits.html page.
    private String linkIn(Uri file) {
        try (InputStream in = getContentResolver().openInputStream(file)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            for (int count; (count = in.read(chunk)) > 0; ) bytes.write(chunk, 0, count);
            Matcher match = Pattern.compile("https://[^\"'\\s<>]*[?&]key=[^\"'\\s<>]*").matcher(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            return match.find() ? match.group().replace("&amp;", "&") : null;
        } catch (IOException | RuntimeException error) {
            return null;
        }
    }

    private void showBook(String link) {
        book = new WebView(this);
        WebSettings settings = book.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // The page sets its own text sizes; a large system font would break the sheet.
        settings.setTextZoom(100);
        // Links stay in the app. At power on, the book can open before the
        // Wi-Fi connects, so a page that does not load tries again.
        book.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                view.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        view.reload();
                    }
                }, 3000);
            }
        });
        book.loadUrl(link);
        setContentView(book);
        hideBars();
    }

    // Hides the status bar and the navigation bar. A swipe in from the edge
    // shows them for a moment.
    private void hideBars() {
        WindowInsetsController bars = getWindow().getInsetsController();
        if (bars == null) return;
        bars.hide(WindowInsets.Type.systemBars());
        bars.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && book != null) hideBars();
    }

    // Back turns back to the page before. The app is the home screen, so Back
    // does not leave it.
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (book != null && book.canGoBack()) book.goBack();
    }
}

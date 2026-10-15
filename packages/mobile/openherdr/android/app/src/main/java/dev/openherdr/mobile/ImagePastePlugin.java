package dev.openherdr.mobile;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.webkit.WebView;

/** Reports from the composer whether it accepts an image paste (see OpenHerdrWebView). */
@CapacitorPlugin(name = "ImagePaste")
public class ImagePastePlugin extends Plugin {

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        WebView webView = getBridge().getWebView();
        if (enabled == null || !(webView instanceof OpenHerdrWebView)) {
            call.reject("enabled is required and the WebView must be OpenHerdrWebView");
            return;
        }

        // Plugin methods are not on the main thread, and restartInput needs to be.
        getBridge().executeOnMainThread(() -> {
            boolean wasEnabled = ((OpenHerdrWebView) webView).setImagePasteEnabled(enabled);
            call.resolve();
            if (enabled && !wasEnabled) {
                ((OpenHerdrWebView) webView).restartInputConnection();
            }
        });
    }
}

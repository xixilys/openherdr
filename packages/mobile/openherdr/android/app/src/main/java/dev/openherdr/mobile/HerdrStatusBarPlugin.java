package dev.openherdr.mobile;

import android.content.res.Configuration;
import android.os.Build;
import android.view.View;
import android.view.Window;
import androidx.core.graphics.ColorUtils;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.capacitorjs.plugins.statusbar.StatusBarPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.util.WebColor;

/** Paints the app backdrop exposed behind transparent Android system bars. */
@CapacitorPlugin(name = "StatusBar")
public class HerdrStatusBarPlugin extends StatusBarPlugin {
    private Integer backdropColor;

    @Override
    @PluginMethod
    public void setBackgroundColor(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            super.setBackgroundColor(call);
            return;
        }
        String color = call.getString("color");
        if (color == null) {
            call.reject("Color must be provided");
            return;
        }
        final int parsedColor;
        try {
            parsedColor = WebColor.parseColor(color);
        } catch (IllegalArgumentException error) {
            call.reject("Invalid background color");
            return;
        }
        getBridge().executeOnMainThread(() -> {
            backdropColor = parsedColor;
            applyBackdrop();
            call.resolve();
        });
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration configuration) {
        super.handleOnConfigurationChanged(configuration);
        getBridge().getWebView().post(this::applyBackdrop);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        getBridge().getWebView().post(this::applyBackdrop);
    }

    private void applyBackdrop() {
        if (backdropColor == null) return;
        Window window = getActivity().getWindow();
        window.getDecorView().setBackgroundColor(backdropColor);
        if (getBridge().getWebView().getParent() instanceof View parent) {
            parent.setBackgroundColor(backdropColor);
        }
        boolean lightBackground = ColorUtils.calculateLuminance(backdropColor) > 0.5;
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(lightBackground);
        controller.setAppearanceLightNavigationBars(lightBackground);
    }
}

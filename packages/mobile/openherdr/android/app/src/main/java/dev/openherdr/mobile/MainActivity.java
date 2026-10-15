package dev.openherdr.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileSharePlugin.class);
        registerPlugin(ImagePastePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        setContentView(R.layout.activity_main);
        // The app adapter must follow the generated StatusBar registration.
        registerPlugin(HerdrStatusBarPlugin.class);
        super.load();
    }
}

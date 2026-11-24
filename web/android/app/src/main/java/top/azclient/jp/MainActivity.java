package top.azclient.jp;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import top.azclient.jp.widgets.WidgetsPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeRoute(intent);
    }

    private void takeRoute(Intent intent) {
        String route = intent == null ? null : intent.getStringExtra(EXTRA_ROUTE);
        if (route == null || !route.startsWith("/")) return;
        intent.removeExtra(EXTRA_ROUTE);
        WidgetsPlugin.deliverRoute(route);
    }

    private FullscreenChromeClient chrome;

    /** 点桌面小组件打开时要去的页面（网页路由） */
    public static final String EXTRA_ROUTE = "top.azclient.jp.ROUTE";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ModelAssetsPlugin.class);
        registerPlugin(WidgetsPlugin.class);
        super.onCreate(savedInstanceState);
        takeRoute(getIntent());
        // Capacitor 自带的处理器一收到"进入全屏"就立即取消，B 站播放器的全屏按钮因此没反应：换成能真正全屏的
        chrome = new FullscreenChromeClient();
        bridge.getWebView().setWebChromeClient(chrome);
        // 全屏看视频时按返回键：先退出全屏，而不是退出页面（只在全屏时拦截）
        getOnBackPressedDispatcher().addCallback(this, chrome.back);
    }

    /** 网页里的视频请求全屏时：把视频视图铺满窗口、隐藏状态栏和导航栏、切到横屏；退出时原样还原 */
    private class FullscreenChromeClient extends BridgeWebChromeClient {
        private View fullscreenView;
        private CustomViewCallback fullscreenCallback;
        private int previousOrientation;
        final OnBackPressedCallback back = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                onHideCustomView();
            }
        };

        FullscreenChromeClient() {
            super(bridge);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            previousOrientation = getRequestedOrientation();
            ViewGroup decor = (ViewGroup) getWindow().getDecorView();
            decor.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(getWindow(), decor);
            insets.hide(WindowInsetsCompat.Type.systemBars());
            insets.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            back.setEnabled(true);
        }

        @Override
        public void onHideCustomView() {
            if (fullscreenView == null) return;
            ViewGroup decor = (ViewGroup) getWindow().getDecorView();
            decor.removeView(fullscreenView);
            fullscreenView = null;
            WindowCompat.getInsetsController(getWindow(), decor).show(WindowInsetsCompat.Type.systemBars());
            setRequestedOrientation(previousOrientation);
            back.setEnabled(false);
            if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
    }
}

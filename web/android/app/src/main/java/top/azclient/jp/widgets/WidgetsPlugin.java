package top.azclient.jp.widgets;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 网页 ↔ 桌面小组件（0.14.0）。
 *   update({ data })      写入今天的快照，四个小组件立即重画
 *   results()             小组件里翻卡攒下的结果
 *   clearResults({count}) 交上去之后删掉前 count 条（中途新攒的保留）
 *   consumeRoute()        点小组件打开 App 时要去的页面；App 已经开着时改发 "route" 事件
 */
@CapacitorPlugin(name = "Widgets")
public class WidgetsPlugin extends Plugin {

    private static String pendingRoute;
    private static WidgetsPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** MainActivity 收到小组件的点击时调用 */
    public static void deliverRoute(String route) {
        WidgetsPlugin p = instance;
        if (p != null && p.hasListeners("route")) {
            JSObject o = new JSObject();
            o.put("route", route);
            p.notifyListeners("route", o);
        } else {
            pendingRoute = route;
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data");
        try {
            new JSONObject(data == null ? "" : data);
        } catch (Exception e) {
            call.reject("快照不是合法的 JSON");
            return;
        }
        WidgetKit.prefs(getContext()).edit().putString(WidgetKit.KEY_SNAPSHOT, data).apply();
        WidgetKit.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void results(PluginCall call) {
        JSObject o = new JSObject();
        o.put("results", WidgetKit.prefs(getContext()).getString(WidgetKit.KEY_RESULTS, "[]"));
        call.resolve(o);
    }

    @PluginMethod
    public void clearResults(PluginCall call) {
        int count = call.getInt("count", 0);
        try {
            JSONArray all = new JSONArray(WidgetKit.prefs(getContext()).getString(WidgetKit.KEY_RESULTS, "[]"));
            JSONArray rest = new JSONArray();
            for (int i = count; i < all.length(); i++) rest.put(all.get(i));
            WidgetKit.prefs(getContext()).edit().putString(WidgetKit.KEY_RESULTS, rest.toString()).apply();
        } catch (Exception ignored) {
            WidgetKit.prefs(getContext()).edit().putString(WidgetKit.KEY_RESULTS, "[]").apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void consumeRoute(PluginCall call) {
        JSObject o = new JSObject();
        o.put("route", pendingRoute);
        pendingRoute = null;
        call.resolve(o);
    }
}

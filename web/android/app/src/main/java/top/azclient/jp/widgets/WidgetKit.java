package top.azclient.jp.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;
import top.azclient.jp.MainActivity;

/**
 * 桌面小组件的公共部分（0.14.0）。
 *
 * 小组件不联网、不登录：网页在打开、离开 App 时把今天的数据整理成一份快照（WidgetsPlugin.update），
 * 四个小组件都只读这份快照。快照的日期不是今天时，按"新的一天还没开始"显示。
 */
public final class WidgetKit {

    static final String PREFS = "widgets";
    static final String KEY_SNAPSHOT = "snapshot";
    static final String KEY_RESULTS = "results";
    static final String KEY_WORD_INDEX = "word_index";
    static final String KEY_REVEALED = "word_revealed";

    private WidgetKit() {}

    /**
     * 按颜色资源设文字颜色。Android 12 起交给桌面按资源取色，系统切深浅色时不用等下次刷新；
     * 更早的系统只能取当下的颜色。
     */
    static void color(Context ctx, RemoteViews v, int viewId, int colorRes) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) v.setColorStateList(viewId, "setTextColor", colorRes);
        else v.setTextColor(viewId, ctx.getColor(colorRes));
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 没有快照（还没打开过新版 App）时返回 null */
    static JSONObject snapshot(Context ctx) {
        String raw = prefs(ctx).getString(KEY_SNAPSHOT, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** 快照是不是今天的：过了零点，今天的分钟数、路线进度都要从零算 */
    static boolean fresh(JSONObject s) {
        return s != null && today().equals(s.optString("date"));
    }

    /** 点小组件打开 App 的某一页（route 是网页里的路由，如 /review） */
    static PendingIntent open(Context ctx, String route, int requestCode) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction(Intent.ACTION_VIEW);
        i.putExtra(MainActivity.EXTRA_ROUTE, route == null || !route.startsWith("/") ? "/" : route);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 发给某个小组件自己的广播（翻卡、朗读） */
    static PendingIntent broadcast(Context ctx, Class<?> cls, String action, int requestCode, Intent extras) {
        Intent i = new Intent(ctx, cls);
        i.setAction(action);
        if (extras != null) i.putExtras(extras);
        return PendingIntent.getBroadcast(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    interface Builder {
        RemoteViews build(Context ctx, JSONObject snapshot);
    }

    static void render(Context ctx, Class<?> cls, Builder b) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, cls));
        if (ids.length == 0) return;
        JSONObject s = snapshot(ctx);
        for (int id : ids) m.updateAppWidget(id, b.build(ctx, s));
    }

    /** 快照换了以后，四个小组件一起重画 */
    public static void refreshAll(Context ctx) {
        render(ctx, ProgressWidget.class, ProgressWidget::build);
        render(ctx, RouteWidget.class, RouteWidget::build);
        render(ctx, WordWidget.class, WordWidget::build);
        CoachWidget.renderAll(ctx);
    }

    /** 今天学了几分钟（快照不是今天的就是 0） */
    static int minutes(JSONObject s) {
        return fresh(s) ? s.optInt("minutesToday", 0) : 0;
    }

    static int goal(JSONObject s) {
        return s == null ? 0 : s.optInt("dailyMinutes", 0);
    }

    static JSONArray array(JSONObject s, String key) {
        JSONArray a = s == null ? null : s.optJSONArray(key);
        return a == null ? new JSONArray() : a;
    }
}

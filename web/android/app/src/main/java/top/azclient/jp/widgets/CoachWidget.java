package top.azclient.jp.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.widget.RemoteViews;
import org.json.JSONObject;
import top.azclient.jp.R;

/**
 * D · 克劳迪娅（4×2）：按今天的进度说一句，半身像在右边，点一下去学习。
 * 缩到 2×2（或者 0.14.0 时放上桌面的旧尺寸）放不下半身像，换成标题旁的小头像。
 */
public class CoachWidget extends AppWidgetProvider {

    /** 比这窄就放不下半身像（4×2 在常见桌面上约 250dp 宽） */
    private static final int WIDE_MIN_DP = 200;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        JSONObject s = WidgetKit.snapshot(ctx);
        for (int id : ids) m.updateAppWidget(id, build(ctx, s, m.getAppWidgetOptions(id)));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager m, int id, Bundle options) {
        m.updateAppWidget(id, build(ctx, WidgetKit.snapshot(ctx), options));
    }

    static void renderAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, CoachWidget.class));
        if (ids.length == 0) return;
        JSONObject s = WidgetKit.snapshot(ctx);
        for (int id : ids) m.updateAppWidget(id, build(ctx, s, m.getAppWidgetOptions(id)));
    }

    /** 快照里的点评是写快照那一刻的；过了零点或者已经学够，就按眼前的情况说 */
    static String line(JSONObject s) {
        if (s == null) return "打开一駅，本小姐才知道您学到哪了。";
        int min = WidgetKit.minutes(s);
        int goal = WidgetKit.goal(s);
        if (!WidgetKit.fresh(s)) return "新的一天。路线已经排好了，……本小姐可没有在等您。";
        if (goal > 0 && min >= goal) return "今天学了 " + min + " 分钟，够了。勉强及格。……早点休息，这不是关心。";
        String coach = s.optString("coach", "");
        if (!coach.isEmpty()) return coach;
        if (min == 0) return "今天还一分钟都没学。红茶泡好了，本小姐没有在等您。";
        return "今天还差 " + (goal - min) + " 分钟。……红茶还温着。";
    }

    static RemoteViews build(Context ctx, JSONObject s, Bundle options) {
        // 桌面还没报尺寸时（刚放上去那一下）按 4×2 画
        int width = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        boolean wide = width == 0 || width >= WIDE_MIN_DP;
        RemoteViews v = new RemoteViews(ctx.getPackageName(), wide ? R.layout.widget_coach : R.layout.widget_coach_small);
        v.setTextViewText(R.id.w_line, line(s));
        if (wide) {
            int goal = WidgetKit.goal(s);
            v.setTextViewText(R.id.w_today, s == null || goal <= 0 ? "" : "今天 " + WidgetKit.minutes(s) + " / " + goal + " 分");
        }
        v.setOnClickPendingIntent(R.id.w_root, WidgetKit.open(ctx, "/", 401));
        return v;
    }
}

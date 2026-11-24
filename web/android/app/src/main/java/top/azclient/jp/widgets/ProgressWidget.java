package top.azclient.jp.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONObject;
import top.azclient.jp.R;

/** A · 今日进度（2×2）：今天学了几分钟、离每日目标还差多少、连续几天 */
public class ProgressWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        JSONObject s = WidgetKit.snapshot(ctx);
        for (int id : ids) m.updateAppWidget(id, build(ctx, s));
    }

    static RemoteViews build(Context ctx, JSONObject s) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_progress);
        int min = WidgetKit.minutes(s);
        int goal = WidgetKit.goal(s);
        v.setTextViewText(R.id.w_minutes, String.valueOf(min));
        v.setTextViewText(R.id.w_goal, goal > 0 ? "/ " + goal + " 分" : "分钟");
        v.setProgressBar(R.id.w_ring, 100, goal > 0 ? Math.min(100, min * 100 / goal) : 0, false);
        int streak = s == null ? 0 : s.optInt("streak", 0);
        // 昨天学过、今天还没学时，连续天数仍有效；快照是更早的就不显示了
        v.setTextViewText(R.id.w_streak, streak > 0 ? "连续 " + streak + " 天" : "");
        String foot;
        if (s == null) foot = "打开一駅同步";
        else if (goal <= 0) foot = "还没定计划";
        else if (min >= goal) foot = "今天的量够了";
        else foot = "还差 " + (goal - min) + " 分钟";
        v.setTextViewText(R.id.w_foot, foot);
        WidgetKit.color(ctx, v, R.id.w_foot, goal > 0 && min >= goal ? R.color.w_accent : R.color.w_muted);
        v.setViewVisibility(R.id.w_streak, streak > 0 ? View.VISIBLE : View.GONE);
        v.setOnClickPendingIntent(R.id.w_root, WidgetKit.open(ctx, "/", 101));
        return v;
    }
}

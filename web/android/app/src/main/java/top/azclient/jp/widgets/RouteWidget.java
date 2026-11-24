package top.azclient.jp.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import top.azclient.jp.R;

/** B · 今日路线（4×2）：当前这一站、今天的三步走到哪了，点一下接着学 */
public class RouteWidget extends AppWidgetProvider {

    private static final int[][] STEP_IDS = {
        {R.id.w_s1_icon, R.id.w_s1_title, R.id.w_s1_detail},
        {R.id.w_s2_icon, R.id.w_s2_title, R.id.w_s2_detail},
        {R.id.w_s3_icon, R.id.w_s3_title, R.id.w_s3_detail},
    };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        JSONObject s = WidgetKit.snapshot(ctx);
        for (int id : ids) m.updateAppWidget(id, build(ctx, s));
    }

    static RemoteViews build(Context ctx, JSONObject s) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_route);
        JSONObject lesson = s == null ? null : s.optJSONObject("lesson");
        v.setTextViewText(R.id.w_lesson, lesson == null ? "一駅" : "第 " + lesson.optInt("order") + " 站 · " + lesson.optString("title"));
        int passed = s == null ? 0 : s.optInt("passed");
        int total = s == null ? 0 : s.optInt("total");
        v.setTextViewText(R.id.w_stations, total > 0 ? passed + " / " + total + " 站" : "");
        v.setProgressBar(R.id.w_bar, Math.max(total, 1), passed, false);
        v.setTextViewText(R.id.w_today, s == null ? "打开一駅同步今天的路线" : "今天 " + WidgetKit.minutes(s) + " / " + WidgetKit.goal(s) + " 分");

        // 过了零点、还没打开 App：路线是昨天的，只显示"去看今天的路线"
        boolean fresh = WidgetKit.fresh(s);
        JSONArray steps = fresh ? WidgetKit.array(s, "steps") : new JSONArray();
        int next = -1;
        for (int i = 0; i < steps.length(); i++) {
            if (!steps.optJSONObject(i).optBoolean("done")) { next = i; break; }
        }
        // 显示三步：从没做的那一步的前一步开始，让人看到"刚做完什么、接下来做什么"
        int start = Math.max(0, Math.min(next < 0 ? steps.length() - 3 : next - 1, steps.length() - 3));
        for (int k = 0; k < 3; k++) {
            JSONObject st = steps.optJSONObject(start + k);
            int[] ids = STEP_IDS[k];
            if (st == null) {
                for (int id : ids) v.setViewVisibility(id, View.INVISIBLE);
                continue;
            }
            for (int id : ids) v.setViewVisibility(id, View.VISIBLE);
            boolean done = st.optBoolean("done");
            boolean current = start + k == next;
            v.setTextViewText(ids[0], done ? "✓" : current ? "▶" : "○");
            WidgetKit.color(ctx, v, ids[0], done || current ? R.color.w_accent : R.color.w_muted);
            v.setTextViewText(ids[1], st.optString("title"));
            WidgetKit.color(ctx, v, ids[1], done ? R.color.w_muted : R.color.w_ink);
            v.setTextViewText(ids[2], done ? "完成" : st.optString("detail"));
        }
        if (steps.length() == 0) {
            v.setViewVisibility(R.id.w_s1_icon, View.VISIBLE);
            v.setViewVisibility(R.id.w_s1_title, View.VISIBLE);
            v.setTextViewText(R.id.w_s1_icon, "▶");
            WidgetKit.color(ctx, v, R.id.w_s1_icon, R.color.w_accent);
            v.setTextViewText(R.id.w_s1_title, s == null ? "还没有数据" : "去看今天的路线");
        }
        boolean allDone = fresh && steps.length() > 0 && next < 0;
        v.setTextViewText(R.id.w_go, allDone ? "已走完" : "继续学");
        String link = next >= 0 ? steps.optJSONObject(next).optString("link", "/") : "/";
        v.setOnClickPendingIntent(R.id.w_root, WidgetKit.open(ctx, "/", 201));
        v.setOnClickPendingIntent(R.id.w_go, WidgetKit.open(ctx, link, 202));
        return v;
    }
}

package top.azclient.jp.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import top.azclient.jp.R;

/**
 * C · 随手一词（4×2）：在桌面上翻卡。先只看正面，点一下看读音和意思，再选"记住了 / 还不会"。
 * 结果先存在本机，下次打开 App 时由网页补交成一轮重学成绩（不影响复习进度）。
 */
public class WordWidget extends AppWidgetProvider {

    static final String ACTION_REVEAL = "top.azclient.jp.widgets.WORD_REVEAL";
    static final String ACTION_ANSWER = "top.azclient.jp.widgets.WORD_ANSWER";
    static final String ACTION_SPEAK = "top.azclient.jp.widgets.WORD_SPEAK";
    static final String EXTRA_KNOWN = "known";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        JSONObject s = WidgetKit.snapshot(ctx);
        for (int id : ids) m.updateAppWidget(id, build(ctx, s));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (ACTION_REVEAL.equals(action)) {
            SharedPreferences p = WidgetKit.prefs(ctx);
            p.edit().putBoolean(WidgetKit.KEY_REVEALED, !p.getBoolean(WidgetKit.KEY_REVEALED, false)).apply();
            refresh(ctx);
        } else if (ACTION_ANSWER.equals(action)) {
            answer(ctx, intent.getBooleanExtra(EXTRA_KNOWN, false));
            refresh(ctx);
        } else if (ACTION_SPEAK.equals(action)) {
            JSONObject w = current(ctx, WidgetKit.snapshot(ctx));
            String url = w == null ? "" : w.optString("audio", "");
            if (url.startsWith("https://")) speak(goAsync(), url);
        } else {
            super.onReceive(ctx, intent);
        }
    }

    private static void refresh(Context ctx) {
        WidgetKit.render(ctx, WordWidget.class, WordWidget::build);
    }

    static JSONObject current(Context ctx, JSONObject s) {
        JSONArray words = WidgetKit.array(s, "words");
        if (words.length() == 0) return null;
        int i = WidgetKit.prefs(ctx).getInt(WidgetKit.KEY_WORD_INDEX, 0);
        return words.optJSONObject(Math.floorMod(i, words.length()));
    }

    /** 记一条结果，换下一张 */
    private static void answer(Context ctx, boolean known) {
        JSONObject s = WidgetKit.snapshot(ctx);
        JSONObject w = current(ctx, s);
        SharedPreferences p = WidgetKit.prefs(ctx);
        if (w == null) return;
        try {
            JSONArray results = new JSONArray(p.getString(WidgetKit.KEY_RESULTS, "[]"));
            // 本机最多攒 500 条，App 很久没打开也不会无限变大
            if (results.length() < 500) results.put(new JSONObject().put("cardId", w.optString("id")).put("known", known));
            p.edit()
                .putString(WidgetKit.KEY_RESULTS, results.toString())
                .putInt(WidgetKit.KEY_WORD_INDEX, p.getInt(WidgetKit.KEY_WORD_INDEX, 0) + 1)
                .putBoolean(WidgetKit.KEY_REVEALED, false)
                .apply();
        } catch (Exception ignored) {
            // 记不下来就算了，不影响继续翻
        }
    }

    /** 播放这个词的朗读（服务端按内容哈希缓存的 mp3）。广播最多能活 10 秒，读一个词足够 */
    private static void speak(BroadcastReceiver.PendingResult pending, String url) {
        MediaPlayer mp = new MediaPlayer();
        Handler h = new Handler(Looper.getMainLooper());
        final boolean[] finished = {false};
        Runnable done = () -> {
            if (finished[0]) return;
            finished[0] = true;
            try { mp.release(); } catch (Exception ignored) {}
            pending.finish();
        };
        try {
            mp.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            mp.setDataSource(url);
            mp.setOnPreparedListener(MediaPlayer::start);
            mp.setOnCompletionListener((m) -> done.run());
            mp.setOnErrorListener((m, what, extra) -> { done.run(); return true; });
            mp.prepareAsync();
            h.postDelayed(done, 9000);
        } catch (Exception e) {
            done.run();
        }
    }

    static RemoteViews build(Context ctx, JSONObject s) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_word);
        JSONObject w = current(ctx, s);
        int count = WidgetKit.array(s, "words").length();
        v.setTextViewText(R.id.w_label, s == null ? "一駅 · 随手一词" : s.optString("wordsLabel", "随手一词") + (count > 0 ? " · " + count + " 张" : ""));
        if (w == null) {
            v.setTextViewText(R.id.w_front, s == null ? "打开一駅" : "没有要背的卡");
            v.setViewVisibility(R.id.w_reading, View.GONE);
            v.setTextViewText(R.id.w_back, s == null ? "同步一下就有词了" : "去复习页看看");
            v.setViewVisibility(R.id.w_back, View.VISIBLE);
            v.setViewVisibility(R.id.w_buttons, View.GONE);
            v.setViewVisibility(R.id.w_speak, View.GONE);
            v.setOnClickPendingIntent(R.id.w_root, WidgetKit.open(ctx, "/review", 301));
            return v;
        }
        boolean revealed = WidgetKit.prefs(ctx).getBoolean(WidgetKit.KEY_REVEALED, false);
        String reading = w.optString("reading", "");
        String back = w.optString("back", "");
        String example = w.optString("example", "");
        v.setTextViewText(R.id.w_front, w.optString("front"));
        v.setTextViewText(R.id.w_reading, reading);
        v.setViewVisibility(R.id.w_reading, revealed && !reading.isEmpty() && !reading.equals(w.optString("front")) ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.w_back, revealed ? back + (example.isEmpty() ? "" : "　｜　" + example) : "点一下看读音和意思");
        v.setViewVisibility(R.id.w_back, View.VISIBLE);
        v.setViewVisibility(R.id.w_buttons, revealed ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.w_speak, w.optString("audio", "").isEmpty() ? View.GONE : View.VISIBLE);

        Intent no = new Intent().putExtra(EXTRA_KNOWN, false);
        Intent yes = new Intent().putExtra(EXTRA_KNOWN, true);
        v.setOnClickPendingIntent(R.id.w_card, WidgetKit.broadcast(ctx, WordWidget.class, ACTION_REVEAL, 302, null));
        v.setOnClickPendingIntent(R.id.w_again, WidgetKit.broadcast(ctx, WordWidget.class, ACTION_ANSWER, 303, no));
        v.setOnClickPendingIntent(R.id.w_known, WidgetKit.broadcast(ctx, WordWidget.class, ACTION_ANSWER, 304, yes));
        v.setOnClickPendingIntent(R.id.w_speak, WidgetKit.broadcast(ctx, WordWidget.class, ACTION_SPEAK, 305, null));
        v.setOnClickPendingIntent(R.id.w_label, WidgetKit.open(ctx, "/review/restudy", 306));
        return v;
    }
}

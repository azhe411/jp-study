package top.azclient.jp;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 内置的离线语音识别模型（v1.6.x）：模型随 APK 放在 assets/models/ 下，不放进网页资源 ——
 * 网页资源会被热更新整包替换，47 MB 的模型不能跟着每次热更新走。
 *
 * 在 APK 里的文件名是 name + ".bin"：打包工具会把 .gz 结尾的资源自动解压并改名，换个扩展名才能原样保存。
 * prepare({ name }) 第一次把模型从 APK 拷到 App 私有目录（约一两秒），之后直接返回路径；
 * 网页端用 Capacitor.convertFileSrc(path) 把它变成同源地址交给识别引擎，全程不联网。
 */
@CapacitorPlugin(name = "ModelAssets")
public class ModelAssetsPlugin extends Plugin {

    @PluginMethod
    public void prepare(PluginCall call) {
        String name = call.getString("name", "");
        // 只认简单文件名，防止拼出 ../ 之类的路径
        if (!name.matches("[A-Za-z0-9._-]{1,120}")) {
            call.reject("模型文件名不合法");
            return;
        }
        getBridge().execute(() -> {
            try {
                File dir = new File(getContext().getFilesDir(), "models");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("无法创建模型目录");
                File out = new File(dir, name);
                if (!out.exists() || out.length() == 0) {
                    File tmp = new File(dir, name + ".part");
                    try (InputStream in = getContext().getAssets().open("models/" + name + ".bin"); OutputStream os = new FileOutputStream(tmp)) {
                        byte[] buf = new byte[1 << 16];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    }
                    if (!tmp.renameTo(out)) throw new Exception("模型拷贝后改名失败");
                }
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("准备识别模型失败：" + e.getMessage(), e);
            }
        });
    }
}

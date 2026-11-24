//! 一駅 · 桌面壳。
//!
//! 页面与业务逻辑都在 web/ 的 React 代码里；这里只多做一件事：
//! 把 refresh token 交给 Windows 凭据管理器保管（契约 v1.1.0 §12.2）；
//! 另外挂上更新器、系统通知与重启插件（契约 v1.3.0 §16），并放行自己页面用麦克风（跟读）。
//! 命令只接受 `jp.` 前缀的键，网页脚本即便失守，也读不到本应用以外的凭据。

const SERVICE: &str = "top.azclient.jp";

fn entry(key: &str) -> Result<keyring::Entry, String> {
  if !key.starts_with("jp.") || key.len() > 64 {
    return Err("invalid key".into());
  }
  keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
  match entry(&key)?.get_password() {
    Ok(v) => Ok(Some(v)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
  entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
  match entry(&key)?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete])
    // 跟读要用麦克风。WebView2 默认要弹自己的授权框，在这个窗口里常常看不到，getUserMedia 就一直卡着。
    // 只放行本应用自己的页面（tauri.localhost）用麦克风，别的权限仍按默认处理
    .on_permission_request(|webview, kind| {
      let own = webview.url().map(|u| u.host_str() == Some("tauri.localhost")).unwrap_or(false);
      match kind {
        tauri::webview::PermissionKind::Microphone if own => tauri::webview::PermissionResponse::Allow,
        _ => tauri::webview::PermissionResponse::Default,
      }
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

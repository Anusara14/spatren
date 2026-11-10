//! SPATREN Desktop backend: a local library of recording packages (the ZIPs phones send), whisper.cpp
//! transcription, and transcript storage. Everything stays on this computer.
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

const MODEL_FILE: &str = "ggml-sinhala-small.bin";

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn data_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(err)?.join(sub);
    fs::create_dir_all(&d).map_err(err)?;
    Ok(d)
}

/// Package and record ids come from file names / the manifest: allow only simple names so they can't walk the disk.
fn safe_name(s: &str) -> Result<&str, String> {
    if !s.is_empty() && s.len() <= 120 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) && !s.contains("..") {
        Ok(s)
    } else {
        Err(format!("invalid name: {s}"))
    }
}

/// Unzip one recordings package into the library. Entries with unsafe paths (zip-slip) are skipped.
#[tauri::command]
fn import_zip(app: AppHandle, path: String) -> Result<String, String> {
    let stem = Path::new(&path).file_stem().and_then(|s| s.to_str()).ok_or("bad file name")?;
    let id: String = stem.chars().map(|c| if c.is_ascii_alphanumeric() || "-_".contains(c) { c } else { '_' }).collect();
    let dest = data_dir(&app, "library")?.join(&id);
    let mut zip = zip::ZipArchive::new(fs::File::open(&path).map_err(err)?).map_err(|e| format!("Not a SPATREN recordings ZIP: {e}"))?;
    if zip.by_name("manifest.json").is_err() {
        return Err("This ZIP has no manifest.json, so it isn't a SPATREN recordings export.".into());
    }
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(err)?;
        let Some(rel) = f.enclosed_name() else { continue };
        let out = dest.join(rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(err)?;
        } else {
            if let Some(p) = out.parent() {
                fs::create_dir_all(p).map_err(err)?;
            }
            io::copy(&mut f, &mut fs::File::create(&out).map_err(err)?).map_err(err)?;
        }
    }
    Ok(id)
}

#[derive(Serialize)]
struct Package {
    id: String,
    dir: String,
    manifest: serde_json::Value,
}

#[tauri::command]
fn list_packages(app: AppHandle) -> Result<Vec<Package>, String> {
    let lib = data_dir(&app, "library")?;
    let mut out = vec![];
    for entry in fs::read_dir(&lib).map_err(err)?.flatten() {
        let dir = entry.path();
        let Ok(text) = fs::read_to_string(dir.join("manifest.json")) else { continue };
        let Ok(manifest) = serde_json::from_str(&text) else { continue };
        out.push(Package { id: entry.file_name().to_string_lossy().into(), dir: dir.to_string_lossy().into(), manifest });
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

#[tauri::command]
fn delete_package(app: AppHandle, id: String) -> Result<(), String> {
    let dir = data_dir(&app, "library")?.join(safe_name(&id)?);
    fs::remove_dir_all(dir).map_err(err)
}

/// Transcripts live next to the audio: library/<package>/transcripts/<record id>.json
#[tauri::command]
fn read_transcript(app: AppHandle, pkg: String, record: String) -> Result<Option<String>, String> {
    let f = data_dir(&app, "library")?.join(safe_name(&pkg)?).join("transcripts").join(format!("{}.json", safe_name(&record)?));
    match fs::read_to_string(f) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
fn write_transcript(app: AppHandle, pkg: String, record: String, json: String) -> Result<(), String> {
    let dir = data_dir(&app, "library")?.join(safe_name(&pkg)?).join("transcripts");
    fs::create_dir_all(&dir).map_err(err)?;
    let tmp = dir.join(format!("{}.json.tmp", safe_name(&record)?));
    fs::write(&tmp, json).map_err(err)?;
    fs::rename(tmp, dir.join(format!("{record}.json"))).map_err(err) // atomic: a crash never leaves half a transcript
}

/// Exports go wherever the user picked in the save dialog.
#[tauri::command]
fn save_text(path: String, text: String) -> Result<(), String> {
    fs::write(path, text).map_err(err)
}

fn whisper_bin(app: &AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let bundled = app.path().resource_dir().map_err(err)?.join("bin").join(name);
    if bundled.exists() {
        return Ok(bundled);
    }
    // Development: the binary built from source into src-tauri/bin.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(name);
    if dev.exists() { Ok(dev) } else { Err("The transcription engine (whisper-cli) is missing from this install.".into()) }
}

#[derive(Serialize)]
struct ModelStatus {
    installed: bool,
    path: String,
    engine: bool,
}

#[tauri::command]
fn model_status(app: AppHandle) -> Result<ModelStatus, String> {
    let path = data_dir(&app, "models")?.join(MODEL_FILE);
    Ok(ModelStatus { installed: path.exists(), path: path.to_string_lossy().into(), engine: whisper_bin(&app).is_ok() })
}

/// Copy a GGML model file the user picked into the app's model folder.
#[tauri::command]
fn install_model(app: AppHandle, src: String) -> Result<(), String> {
    use std::io::Read;
    let dest = data_dir(&app, "models")?.join(MODEL_FILE);
    let mut magic = [0u8; 4];
    fs::File::open(&src).and_then(|mut f| f.read_exact(&mut magic)).map_err(err)?;
    if &magic != b"lmgg" {
        return Err("That file isn't a whisper.cpp (GGML) model.".into());
    }
    fs::copy(&src, dest).map(|_| ()).map_err(err) // streamed copy: models are hundreds of MB
}

/// Transcribe a 16 kHz mono WAV (decoded by the window from the phone's WebM/MP4) with whisper.cpp.
/// The WAV arrives as the raw request body; returns whisper's JSON (segments with times).
#[tauri::command]
async fn transcribe(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(wav) = request.body() else { return Err("expected WAV bytes".into()) };
    let tmp = data_dir(&app, "tmp")?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(err)?.as_millis();
    let wav_path = tmp.join(format!("job-{stamp}.wav"));
    let out_base = tmp.join(format!("job-{stamp}"));
    fs::write(&wav_path, wav).map_err(err)?;
    let bin = whisper_bin(&app)?;
    let model = data_dir(&app, "models")?.join(MODEL_FILE);
    if !model.exists() {
        return Err("No Sinhala model installed yet. Open Settings and add the model file.".into());
    }
    let threads = std::thread::available_parallelism().map(|n| n.get().saturating_sub(1).max(1)).unwrap_or(4);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&bin);
        cmd.arg("-m").arg(&model).arg("-f").arg(&wav_path).args(["-l", "si", "-oj", "-np", "-t", &threads.to_string()]).arg("-of").arg(&out_base);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
        }
        let out = cmd.output().map_err(err)?;
        let json = fs::read_to_string(out_base.with_extension("json"));
        let _ = fs::remove_file(&wav_path);
        let _ = fs::remove_file(out_base.with_extension("json"));
        match json {
            Ok(j) if out.status.success() => Ok(j),
            _ => Err(format!("Transcription failed: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("unknown error"))),
        }
    })
    .await
    .map_err(err)?;
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            import_zip,
            list_packages,
            delete_package,
            read_transcript,
            write_transcript,
            save_text,
            model_status,
            install_model,
            transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running SPATREN Desktop");
}

#[cfg(test)]
mod tests {
    use super::safe_name;

    #[test]
    fn names_cannot_escape_the_library() {
        assert!(safe_name("spatren-242343J-20261111-1500").is_ok());
        assert!(safe_name("../../etc").is_err());
        assert!(safe_name("a/b").is_err());
        assert!(safe_name("").is_err());
    }
}

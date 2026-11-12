//! SPATREN Desktop backend: a local library of recording packages (the ZIPs phones send), whisper.cpp
//! transcription, and transcript storage. Everything stays on this computer.
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

const MODEL_FILE: &str = "ggml-sinhala-small.bin";

/// Unique suffix for temp files, so overlapping saves or jobs never share one.
fn unique() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("{ms}-{}", N.fetch_add(1, Ordering::Relaxed))
}

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

/// Package id from the ZIP's file name: safe characters only and short enough for safe_name.
/// The window derives the same id (App.tsx packageId); keep the two in step.
fn package_id(path: &str) -> Result<String, String> {
    let stem = Path::new(path).file_stem().and_then(|s| s.to_str()).ok_or("bad file name")?;
    Ok(stem.chars().take(100).map(|c| if c.is_ascii_alphanumeric() || "-_".contains(c) { c } else { '_' }).collect())
}

/// Unzip one recordings package into the library (off the UI thread: big ZIPs take seconds).
#[tauri::command]
async fn import_zip(app: AppHandle, path: String) -> Result<String, String> {
    let id = package_id(&path)?;
    let dest = data_dir(&app, "library")?.join(&id);
    tauri::async_runtime::spawn_blocking(move || unpack(Path::new(&path), &dest)).await.map_err(err)??;
    Ok(id)
}

// A day of phone recordings is well under 2 GB; anything bigger is a broken or hostile file (zip bomb).
const MAX_UNPACKED: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;

/// Entries with unsafe paths (zip-slip) are skipped, and so is anything under transcripts/: re-importing a
/// ZIP must never overwrite the corrected transcripts already on this laptop.
fn unpack(path: &Path, dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path).map_err(err)?).map_err(|e| format!("Not a SPATREN recordings ZIP: {e}"))?;
    if zip.by_name("manifest.json").is_err() {
        return Err("This ZIP has no manifest.json, so it isn't a SPATREN recordings export.".into());
    }
    if zip.len() > MAX_ENTRIES {
        return Err("This ZIP has far too many files to be a SPATREN export.".into());
    }
    let mut budget = MAX_UNPACKED;
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(err)?;
        let Some(rel) = f.enclosed_name() else { continue };
        if rel.starts_with("transcripts") {
            continue;
        }
        let out = dest.join(rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(err)?;
            continue;
        }
        if let Some(p) = out.parent() {
            fs::create_dir_all(p).map_err(err)?;
        }
        // Count real bytes written, not the size the ZIP claims.
        let written = io::copy(&mut io::Read::take(f, budget + 1), &mut fs::File::create(&out).map_err(err)?).map_err(err)?;
        if written > budget {
            let _ = fs::remove_file(&out);
            return Err("This ZIP unpacks to more than 4 GB, so it isn't a normal SPATREN export.".into());
        }
        budget -= written;
    }
    Ok(())
}

#[derive(Serialize)]
struct Package {
    id: String,
    dir: String,
    manifest: serde_json::Value,
}

#[tauri::command]
async fn list_packages(app: AppHandle) -> Result<Vec<Package>, String> {
    let lib = data_dir(&app, "library")?;
    tauri::async_runtime::spawn_blocking(move || read_library(&lib)).await.map_err(err)?
}

fn read_library(lib: &Path) -> Result<Vec<Package>, String> {
    let mut out = vec![];
    for entry in fs::read_dir(lib).map_err(err)?.flatten() {
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
    let tmp = dir.join(format!("{}.json.{}.tmp", safe_name(&record)?, unique()));
    fs::write(&tmp, json).map_err(err)?;
    fs::rename(tmp, dir.join(format!("{record}.json"))).map_err(err) // atomic: a crash never leaves half a transcript
}

/// Exports go wherever the user picked in the save dialog.
#[tauri::command]
fn save_text(path: String, text: String) -> Result<(), String> {
    fs::write(path, text).map_err(err)
}


/// Small app files kept next to the library, e.g. project.json (the codebook).
#[tauri::command]
fn read_app_file(app: AppHandle, name: String) -> Result<Option<String>, String> {
    match fs::read_to_string(app.path().app_data_dir().map_err(err)?.join(safe_name(&name)?)) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

#[tauri::command]
fn write_app_file(app: AppHandle, name: String, text: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    let tmp = dir.join(format!("{}.{}.tmp", safe_name(&name)?, unique()));
    fs::write(&tmp, text).map_err(err)?;
    fs::rename(tmp, dir.join(name)).map_err(err)
}

/// ZIPs in a watched folder (e.g. LocalSend's download folder), for auto-import.
#[tauri::command]
fn list_zips(dir: String) -> Result<Vec<String>, String> {
    Ok(fs::read_dir(&dir)
        .map_err(err)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip")))
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
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
async fn install_model(app: AppHandle, src: String) -> Result<(), String> {
    use std::io::Read;
    let dir = data_dir(&app, "models")?;
    let mut magic = [0u8; 4];
    fs::File::open(&src).and_then(|mut f| f.read_exact(&mut magic)).map_err(err)?;
    if &magic != b"lmgg" {
        return Err("That file isn't a whisper.cpp (GGML) model.".into());
    }
    // Copy beside the old model, then swap: a failed copy (disk full) leaves the working model in place.
    tauri::async_runtime::spawn_blocking(move || {
        let tmp = dir.join(format!("{MODEL_FILE}.{}.tmp", unique()));
        fs::copy(&src, &tmp).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            err(e)
        })?;
        fs::rename(&tmp, dir.join(MODEL_FILE)).map_err(err)
    })
    .await
    .map_err(err)?
}

/// Transcribe a 16 kHz mono WAV (decoded by the window from the phone's WebM/MP4) with whisper.cpp.
/// The WAV arrives as the raw request body; returns whisper's JSON (segments with times).
#[tauri::command]
async fn transcribe(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(wav) = request.body() else { return Err("expected WAV bytes".into()) };
    let bin = whisper_bin(&app)?;
    let model = data_dir(&app, "models")?.join(MODEL_FILE);
    if !model.exists() {
        return Err("No Sinhala model installed yet. Open Settings and add the model file.".into());
    }
    let tmp = data_dir(&app, "tmp")?;
    let job = unique();
    let wav_path = tmp.join(format!("job-{job}.wav"));
    let out_base = tmp.join(format!("job-{job}"));
    fs::write(&wav_path, wav).map_err(err)?;
    // Half the logical cores (≈ physical cores): hyper-threads slow whisper down rather than help.
    let threads = std::thread::available_parallelism().map(|n| (n.get() / 2).max(2)).unwrap_or(4);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&bin);
        cmd.arg("-m").arg(&model).arg("-f").arg(&wav_path)// Beam 2 without temperature fallback: ~6x faster than the defaults on the Sinhala model, same text.
            // -ml 80 -sow: lines of ~15 s split at word boundaries, short enough to label speakers and quote.
            .args(["-l", "si", "-bs", "2", "-bo", "2", "-nf", "-ml", "80", "-sow", "-oj", "-np", "-t", &threads.to_string()]).arg("-of").arg(&out_base);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing up
        }
        let out = cmd.output().map_err(err)?;
        // whisper can cut a Sinhala character between tokens, leaving invalid UTF-8: read lossily, not fail.
        let json = fs::read(out_base.with_extension("json")).map(|b| String::from_utf8_lossy(&b).into_owned());
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
        .setup(|app| {
            // Audio left from a transcription interrupted by a crash or shutdown.
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = fs::remove_dir_all(dir.join("tmp"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            import_zip,
            list_packages,
            delete_package,
            read_transcript,
            write_transcript,
            save_text,
            read_app_file,
            write_app_file,
            list_zips,
            model_status,
            install_model,
            transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running SPATREN Desktop");
}

#[cfg(test)]
mod tests {
    use super::{package_id, safe_name, unpack};
    use std::io::Write;

    fn zip_with(files: &[(&str, &[u8])]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("spatren-test-{}.zip", super::unique()));
        let mut w = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
        for (name, data) in files {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
        p
    }

    #[test]
    fn reimport_never_overwrites_transcripts() {
        let dest = std::env::temp_dir().join(format!("spatren-dest-{}", super::unique()));
        std::fs::create_dir_all(dest.join("transcripts")).unwrap();
        std::fs::write(dest.join("transcripts/r1.json"), "corrected by a student").unwrap();
        let z = zip_with(&[("manifest.json", b"{}"), ("transcripts/r1.json", b"from the zip"), ("../evil.txt", b"x"), ("audio/a.webm", b"123")]);
        unpack(&z, &dest).unwrap();
        assert_eq!(std::fs::read_to_string(dest.join("transcripts/r1.json")).unwrap(), "corrected by a student");
        assert_eq!(std::fs::read(dest.join("audio/a.webm")).unwrap(), b"123");
        assert!(!dest.parent().unwrap().join("evil.txt").exists());
    }

    #[test]
    fn rejects_zips_without_a_manifest() {
        let z = zip_with(&[("audio/a.webm", b"1")]);
        assert!(unpack(&z, &std::env::temp_dir().join("spatren-nomanifest")).is_err());
    }

    #[test]
    fn package_ids_fit_safe_name() {
        let long = format!("C:/x/{}.zip", "spatren-".repeat(40));
        assert!(safe_name(&package_id(&long).unwrap()).is_ok());
        assert_eq!(package_id("C:/Downloads/spatren-242343J (1).zip").unwrap(), "spatren-242343J__1_");
    }

    /// A ZIP written by the phone exporter (fflate) must unpack here. Point SPATREN_TEST_ZIP at one to run it.
    #[test]
    fn unpacks_a_phone_export() {
        let Ok(zip) = std::env::var("SPATREN_TEST_ZIP") else { return };
        let dest = std::env::temp_dir().join("spatren-unpack-test");
        let _ = std::fs::remove_dir_all(&dest);
        unpack(std::path::Path::new(&zip), &dest).unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dest.join("manifest.json")).unwrap()).unwrap();
        for r in manifest["records"].as_array().unwrap() {
            for a in r["audio"].as_array().unwrap() {
                let f = dest.join(a["file"].as_str().unwrap());
                assert_eq!(std::fs::metadata(&f).unwrap().len(), a["bytes"].as_u64().unwrap(), "{f:?}");
            }
        }
    }

    #[test]
    fn names_cannot_escape_the_library() {
        assert!(safe_name("spatren-242343J-20261111-1500").is_ok());
        assert!(safe_name("../../etc").is_err());
        assert!(safe_name("a/b").is_err());
        assert!(safe_name("").is_err());
    }
}

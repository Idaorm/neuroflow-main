// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn use_project_python() {
    use std::{env, path::Path};

    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("NeuroFlow project directory not found");
    let (bin_dir, executable) = if cfg!(target_os = "windows") {
        ("Scripts", "python.exe")
    } else {
        ("bin", "python")
    };
    let scripts = project_root.join(".venv").join(bin_dir);
    assert!(
        scripts.join(executable).is_file(),
        "NeuroFlow Python environment is missing"
    );

    let existing = env::var_os("PATH").unwrap_or_default();
    let path = env::join_paths(std::iter::once(scripts).chain(env::split_paths(&existing)))
        .expect("Cannot configure the Python search path");
    env::set_var("PATH", path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    use_project_python();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, any(target_os = "windows", target_os = "macos")))]
mod tests {
    use std::{path::Path, process::Command};

    #[test]
    fn python_command_uses_project_environment() {
        super::use_project_python();
        let output = Command::new("python")
            .args(["-c", "import sys; print(sys.prefix)"])
            .output()
            .expect("Python could not be launched");
        assert!(output.status.success());

        let actual = String::from_utf8(output.stdout).expect("Invalid Python output");
        let expected = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(".venv");
        assert_eq!(
            Path::new(actual.trim()).canonicalize().unwrap(),
            expected.canonicalize().unwrap()
        );
    }
}

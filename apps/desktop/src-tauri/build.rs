fn main() {
    // Embed the absolute bridge path at compile time
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let bridge_path = std::path::Path::new(&manifest_dir)
        .join("../bridge/dist/main.js")
        .canonicalize()
        .expect("Bridge not built! Run: pnpm --filter @openquery/desktop build:bridge");
    println!(
        "cargo:rustc-env=BRIDGE_SCRIPT_PATH={}",
        bridge_path.display()
    );
    tauri_build::build()
}

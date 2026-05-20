use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Wry};

/// Build the native application menu (macOS top bar + Windows/Linux in-window).
/// Each item with an `id` fires a `menu:<id>` event the frontend listens to.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let app_name = "Database Manager";
    let about_meta = AboutMetadataBuilder::new()
        .name(Some(app_name))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .build();

    // ── App menu (macOS uses first submenu as App menu)
    let app_menu = SubmenuBuilder::new(app, app_name)
        .item(&PredefinedMenuItem::about(app, Some("Acerca de Database Manager"), Some(about_meta))?)
        .separator()
        .item(&MenuItemBuilder::with_id("app.settings", "Ajustes…").accelerator("CmdOrCtrl+,").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("app.check_updates", "Buscar actualizaciones…").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("Servicios"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Ocultar Database Manager"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Ocultar otros"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Mostrar todo"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Salir"))?)
        .build()?;

    // ── Archivo
    let file_menu = SubmenuBuilder::new(app, "Archivo")
        .item(&MenuItemBuilder::with_id("file.new_connection", "Nueva conexión").accelerator("CmdOrCtrl+N").build(app)?)
        .item(&MenuItemBuilder::with_id("file.connections", "Ver todas las conexiones").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file.export_connections", "Exportar conexiones…").build(app)?)
        .item(&MenuItemBuilder::with_id("file.import_connections", "Importar conexiones…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("file.close_tab", "Cerrar pestaña").accelerator("CmdOrCtrl+W").build(app)?)
        .build()?;

    // ── Editar (standard system items for in-webview text editing)
    let edit_menu = SubmenuBuilder::new(app, "Editar")
        .item(&PredefinedMenuItem::undo(app, Some("Deshacer"))?)
        .item(&PredefinedMenuItem::redo(app, Some("Rehacer"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("Cortar"))?)
        .item(&PredefinedMenuItem::copy(app, Some("Copiar"))?)
        .item(&PredefinedMenuItem::paste(app, Some("Pegar"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("Seleccionar todo"))?)
        .separator()
        .item(&MenuItemBuilder::with_id("edit.find", "Buscar (paleta)…").accelerator("CmdOrCtrl+K").build(app)?)
        .build()?;

    // ── Ver — Tema / Acento / Densidad submenus
    let theme_submenu = SubmenuBuilder::new(app, "Tema")
        .item(&MenuItemBuilder::with_id("view.theme.light", "Claro").build(app)?)
        .item(&MenuItemBuilder::with_id("view.theme.dark", "Oscuro").build(app)?)
        .item(&MenuItemBuilder::with_id("view.theme.system", "Sistema").build(app)?)
        .item(&MenuItemBuilder::with_id("view.theme.midnight", "Midnight").build(app)?)
        .item(&MenuItemBuilder::with_id("view.theme.sepia", "Sepia").build(app)?)
        .item(&MenuItemBuilder::with_id("view.theme.solarized", "Solarized").build(app)?)
        .item(&MenuItemBuilder::with_id("view.theme.schedule", "Horario").build(app)?)
        .build()?;

    let accent_submenu = SubmenuBuilder::new(app, "Acento")
        .item(&MenuItemBuilder::with_id("view.accent.cyan", "Cian").build(app)?)
        .item(&MenuItemBuilder::with_id("view.accent.violet", "Violeta").build(app)?)
        .item(&MenuItemBuilder::with_id("view.accent.emerald", "Esmeralda").build(app)?)
        .item(&MenuItemBuilder::with_id("view.accent.amber", "Ámbar").build(app)?)
        .item(&MenuItemBuilder::with_id("view.accent.rose", "Rosa").build(app)?)
        .item(&MenuItemBuilder::with_id("view.accent.indigo", "Índigo").build(app)?)
        .build()?;

    let density_submenu = SubmenuBuilder::new(app, "Densidad")
        .item(&MenuItemBuilder::with_id("view.density.compact", "Compacta").build(app)?)
        .item(&MenuItemBuilder::with_id("view.density.comfortable", "Cómoda").build(app)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "Ver")
        .item(&MenuItemBuilder::with_id("view.dashboard", "Inicio").build(app)?)
        .item(&MenuItemBuilder::with_id("view.connections", "Conexiones").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view.toggle_sidebar", "Mostrar/ocultar sidebar").accelerator("CmdOrCtrl+B").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view.zoom_in", "Aumentar zoom").accelerator("CmdOrCtrl+=").build(app)?)
        .item(&MenuItemBuilder::with_id("view.zoom_out", "Reducir zoom").accelerator("CmdOrCtrl+-").build(app)?)
        .item(&MenuItemBuilder::with_id("view.zoom_reset", "Restablecer zoom").accelerator("CmdOrCtrl+0").build(app)?)
        .separator()
        .item(&theme_submenu)
        .item(&accent_submenu)
        .item(&density_submenu)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, Some("Pantalla completa"))?)
        .build()?;

    // ── Ventana
    let window_menu = SubmenuBuilder::new(app, "Ventana")
        .item(&PredefinedMenuItem::minimize(app, Some("Minimizar"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("Maximizar"))?)
        .separator()
        .item(&MenuItemBuilder::with_id("window.tab.1", "Pestaña 1").accelerator("CmdOrCtrl+1").build(app)?)
        .item(&MenuItemBuilder::with_id("window.tab.2", "Pestaña 2").accelerator("CmdOrCtrl+2").build(app)?)
        .item(&MenuItemBuilder::with_id("window.tab.3", "Pestaña 3").accelerator("CmdOrCtrl+3").build(app)?)
        .item(&MenuItemBuilder::with_id("window.tab.4", "Pestaña 4").accelerator("CmdOrCtrl+4").build(app)?)
        .item(&MenuItemBuilder::with_id("window.tab.5", "Pestaña 5").accelerator("CmdOrCtrl+5").build(app)?)
        .item(&MenuItemBuilder::with_id("window.tab.6", "Pestaña 6").accelerator("CmdOrCtrl+6").build(app)?)
        .item(&MenuItemBuilder::with_id("window.tab.7", "Pestaña 7").accelerator("CmdOrCtrl+7").build(app)?)
        .item(&MenuItemBuilder::with_id("window.tab.8", "Pestaña 8").accelerator("CmdOrCtrl+8").build(app)?)
        .item(&MenuItemBuilder::with_id("window.tab.9", "Pestaña 9").accelerator("CmdOrCtrl+9").build(app)?)
        .build()?;

    // ── Ayuda. "Acerca de…" lives in the macOS App menu already (predefined
    // About item with metadata) — no need for a second entry here.
    let help_menu = SubmenuBuilder::new(app, "Ayuda")
        .item(&MenuItemBuilder::with_id("help.shortcuts", "Atajos de teclado…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("help.docs", "Documentación").build(app)?)
        .item(&MenuItemBuilder::with_id("help.github", "GitHub").build(app)?)
        .item(&MenuItemBuilder::with_id("help.report", "Reportar un bug…").build(app)?)
        .build()?;

    let menu = MenuBuilder::<Wry, AppHandle>::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

/// Install the menu-event listener that forwards every action to the frontend
/// as a `menu:<id>` event payload.
pub fn install_event_handler(app: &AppHandle) {
    let handle = app.clone();
    app.on_menu_event(move |_app, event| {
        let id = event.id().0.clone();
        let _ = handle.emit("menu", id);
    });
}

import os
from pathlib import Path
from PyQt6.QtWidgets import QPushButton
from PyQt6.QtCore import Qt

DATA_DIR = Path(
    os.environ.get(
        "NEUROFLOW_DATA_DIR",
        str(Path.home() / "Documents" / "NeuroTech_Data"),
    )
).expanduser()

DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── PALETTE COLORI (Stile Dark Moderno) ──────────────────────────────────────
C_BG       = "#0f1117"  # Sfondo principale dell'applicazione
C_SURFACE  = "#1a1d27"  # Sfondo di schede, grafici e pannelli interni
C_BORDER   = "#2a2d3a"  # Colore dei bordi, griglie e linee divisorie
C_ACCENT   = "#4f8ef7"  # Colore primario (Blu per azioni principali)
C_GREEN    = "#2ecc71"  # Verde per operazioni riuscite o aggregazioni
C_RED      = "#e74c3c"  # Rosso per interruzioni, eliminazioni o avvisi
C_TEXT     = "#e8e6e0"  # Colore del testo principale (chiaro)
C_MUTED    = "#6b7280"  # Colore grigio per testi secondari o stati disabilitati

# ── FOGLIO DI STILE GLOBALE (QSS) ────────────────────────────────────────────
STYLE_BASE = f"""
    QMainWindow, QWidget {{
        background: {C_BG};
        color: {C_TEXT};
        font-family: 'Segoe UI', -apple-system, sans-serif;
        font-size: 13px;
    }}
    QTabWidget::pane {{
        border: 1px solid {C_BORDER};
        background: {C_SURFACE};
        border-radius: 8px;
    }}
    QTabBar::tab {{
        background: {C_SURFACE};
        color: {C_MUTED};
        padding: 8px 18px;
        border-radius: 6px 6px 0 0;
        margin-right: 2px;
        font-weight: 500;
    }}
    QTabBar::tab:selected {{
        background: {C_ACCENT};
        color: white;
    }}
    QPushButton {{
        background: {C_SURFACE};
        color: {C_TEXT};
        border: 1px solid {C_BORDER};
        border-radius: 6px;
        padding: 8px 16px;
    }}
    QPushButton:hover {{
        background: {C_BORDER};
    }}
    QPushButton:disabled {{
        color: {C_MUTED};
        background: #151821;
        border-color: #1f222e;
    }}
    QLabel {{
        color: {C_TEXT};
    }}
    QComboBox {{
        background: {C_SURFACE};
        color: {C_TEXT};
        border: 1px solid {C_BORDER};
        border-radius: 6px;
        padding: 6px 10px;
    }}
    QLineEdit {{
        background: {C_SURFACE};
        color: {C_TEXT};
        border: 1px solid {C_BORDER};
        border-radius: 6px;
        padding: 6px 10px;
    }}
    QScrollArea {{
        background: {C_BG};
        border: none;
    }}
"""

def styled_btn(text, color=C_ACCENT, text_color="white", disabled_bg=None):
    btn = QPushButton(text)
    if disabled_bg:
        style = f"""
            QPushButton {{
                background: {color};
                color: {text_color};
                border: none;
                border-radius: 6px;
                padding: 10px 20px;
                font-size: 13px;
                font-weight: 600;
            }}
            QPushButton:disabled {{
                background: {disabled_bg};
                color: {C_MUTED};
            }}
        """
    else:
        style = f"""
            background: {color};
            color: {text_color};
            border: none;
            border-radius: 6px;
            padding: 10px 20px;
            font-size: 13px;
            font-weight: 600;
        """
    btn.setStyleSheet(style)
    btn.setCursor(Qt.CursorShape.PointingHandCursor)
    return btn
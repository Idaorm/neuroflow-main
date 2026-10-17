import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from scipy.ndimage import gaussian_filter
from pathlib import Path
from datetime import datetime

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTabWidget,
    QComboBox, QMessageBox, QFileDialog, QFrame, QGridLayout,
    QScrollArea, QSizePolicy
)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QPixmap

from config import (C_TEXT, C_GREEN, C_ACCENT, C_SURFACE, C_BORDER, C_BG,
                    C_MUTED, C_RED, DATA_DIR, styled_btn)

# ── Colonne Performance Emotiv ────────────────────────────────────────────────
# Mappa chiave interna → nome colonna esatto nell'Excel Emotiv
PERF_COL_MAP = {
    "attention": "attention",
    "eng":       "eng",
    "exc":       "exc",
    "lex":       "lex",
    "str":       "str",
    "rel":       "rel",
    "int":       "int",
}
PERF_LABELS = {
    "attention": ("Attention",  "#4f8ef7"),
    "eng":       ("Engagement", "#2ecc71"),
    "exc":       ("Excitement", "#f1c40f"),
    "lex":       ("Lex",        "#1abc9c"),
    "str":       ("Stress",     "#e74c3c"),
    "rel":       ("Relax",      "#9b59b6"),
    "int":       ("Interest",   "#e67e22"),
}
BAND_COLORS = {
    "theta": "#2ecc71", "alpha": "#3498db",
    "betaL": "#f1c40f", "betaH": "#e67e22", "gamma": "#9b59b6"
}


# ── Utility EEG ───────────────────────────────────────────────────────────────
def _load_sheet(path, sheet):
    try:
        return pd.read_excel(path, sheet_name=sheet)
    except Exception:
        return None


def _load_markers(path):
    try:
        df = pd.read_excel(path, sheet_name="Markers")
        return df[["time", "label"]].dropna().to_dict("records")
    except Exception:
        return []


def _slide_windows(markers):
    slides = [m for m in markers if str(m.get("label", "")).startswith("slide_")]
    wins = []
    for i, m in enumerate(slides):
        t0 = float(m["time"])
        if i + 1 < len(slides):
            t1 = float(slides[i + 1]["time"])
        else:
            stop = [s for s in markers if s.get("label") in ("stop", "STOP_TOBII")]
            t1 = float(stop[0]["time"]) if stop else float("inf")
        wins.append({"label": m["label"], "t_start": t0, "t_end": t1,
                     "duration_s": round(t1 - t0, 2) if t1 != float("inf") else None})
    return wins


def _filter_window(df, t0, t1):
    if df is None or "time" not in df.columns:
        return pd.DataFrame()
    return df[(df["time"] >= t0) & (df["time"] < t1)].copy()


def _avg_metrics(df_perf, t0, t1):
    sub = _filter_window(df_perf, t0, t1)
    if sub.empty:
        return {}
    result = {}
    for key, col in PERF_COL_MAP.items():
        if col in sub.columns:
            try:
                result[key] = float(sub[col].mean())
            except Exception:
                pass
    return result


def _avg_bands(df_pow, t0, t1):
    sub = _filter_window(df_pow, t0, t1)
    if sub.empty:
        return {}
    result = {}
    for band in ["theta", "alpha", "betaL", "betaH", "gamma"]:
        cols = [c for c in sub.columns if c.endswith("/" + band)]
        if cols:
            try:
                result[band] = float(sub[cols].mean().mean())
            except Exception:
                pass
    return result


# ── Widget helpers ────────────────────────────────────────────────────────────
def _dark_fig(figsize=(8, 3)):
    fig = Figure(figsize=figsize)
    fig.patch.set_facecolor(C_SURFACE)
    return fig


def _style_ax(ax):
    ax.set_facecolor("#0f1117")
    for sp in ax.spines.values():
        sp.set_edgecolor(C_BORDER)
    ax.tick_params(colors=C_MUTED)
    ax.xaxis.label.set_color(C_MUTED)
    ax.yaxis.label.set_color(C_MUTED)
    ax.title.set_color(C_TEXT)


def _sep():
    line = QFrame()
    line.setFrameShape(QFrame.Shape.HLine)
    line.setStyleSheet(f"color: {C_BORDER};")
    return line


def _card(inner_widget, title=None):
    frame = QFrame()
    frame.setStyleSheet(
        f"QFrame {{ background: {C_SURFACE}; border-radius: 12px;"
        f" border: 1px solid {C_BORDER}; }}"
    )
    lay = QVBoxLayout(frame)
    lay.setContentsMargins(16, 14, 16, 14)
    lay.setSpacing(10)
    if title:
        lbl = QLabel(title)
        lbl.setStyleSheet(
            f"color: {C_TEXT}; font-size: 13px; font-weight: 700; border: none;"
        )
        lay.addWidget(lbl)
    lay.addWidget(inner_widget)
    return frame


# ══════════════════════════════════════════════════════════════════════════════
class ResultScreen(QWidget):
    def __init__(self, image_paths, session_name, points_per_image, on_restart,
                 emotiv_file=None, session_start_epoch=None, session_end_epoch=None):
        super().__init__()
        self.image_paths        = image_paths if isinstance(image_paths, list) else [image_paths]
        self.session_name       = session_name
        self.points_per_image   = points_per_image
        self.on_restart         = on_restart
        self.emotiv_file        = emotiv_file
        self.session_start_epoch = session_start_epoch
        self.session_end_epoch   = session_end_epoch

        # Carica dati Emotiv
        if emotiv_file and os.path.exists(str(emotiv_file)):
            self.df_perf = _load_sheet(emotiv_file, "Performance")
            self.df_pow  = _load_sheet(emotiv_file, "BandPower")
            self.markers = _load_markers(emotiv_file)
        else:
            self.df_perf = None
            self.df_pow  = None
            self.markers = []

        self.windows = _slide_windows(self.markers)
        self._build()

    # ── Layout principale ─────────────────────────────────────────────────────
    def _build(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 20, 20, 20)
        root.setSpacing(12)

        # Header
        hdr = QHBoxLayout()
        title = QLabel(f"  {self.session_name}")
        title.setStyleSheet(f"font-size: 20px; font-weight: 700; color: {C_TEXT};")
        hdr.addWidget(title)
        hdr.addStretch()
        btn_report = styled_btn("  Salva report PNG", C_GREEN)
        btn_report.clicked.connect(self._save_report)
        hdr.addWidget(btn_report)
        btn_home = styled_btn("↩  Home", C_ACCENT)
        btn_home.clicked.connect(self.on_restart)
        hdr.addWidget(btn_home)
        root.addLayout(hdr)

        # Tre tab principali
        tabs = QTabWidget()
        tabs.addTab(self._tab_session(),    "  Sessione")
        tabs.addTab(self._tab_images(),     "  Analisi immagini")
        tabs.addTab(self._tab_advanced(),   "  Analisi avanzata")
        root.addWidget(tabs, stretch=1)

    # ══════════════════════════════════════════════════════════════════════════
    # TAB 1 — SESSIONE
    # ══════════════════════════════════════════════════════════════════════════
    def _tab_session(self):
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("border: none;")
        container = QWidget()
        lay = QVBoxLayout(container)
        lay.setSpacing(16)
        lay.setContentsMargins(12, 12, 12, 12)

        # ── Riepilogo numerico ───────────────────────────────────────────────
        total_gaze = sum(len(p) for p in self.points_per_image)
        n_img      = len(self.image_paths)
        met_count  = len(self.df_perf) if self.df_perf is not None else 0
        mot_count  = 0
        if self.emotiv_file and os.path.exists(str(self.emotiv_file)):
            df_mot = _load_sheet(self.emotiv_file, "Motion")
            mot_count = len(df_mot) if df_mot is not None else 0

        session_date = ""
        if self.session_start_epoch:
            try:
                session_date = datetime.fromtimestamp(
                    self.session_start_epoch
                ).strftime("%d %B %Y")
            except Exception:
                pass

        # Durata totale
        dur_s = None
        if self.windows:
            last = self.windows[-1]
            if last["t_end"] != float("inf") and last["t_start"]:
                dur_s = round(last["t_end"] - self.windows[0]["t_start"])

        kpi_data = [
            ("Immagini",       str(n_img),           C_ACCENT),
            ("Punti gaze",     f"{total_gaze:,}",    C_GREEN),
            ("Campioni MET",   str(met_count),        "#f1c40f"),
            ("Campioni MOT",   str(mot_count),        "#9b59b6"),
            ("Durata (s)",     str(dur_s) if dur_s else "—", C_MUTED),
        ]

        kpi_frame = QFrame()
        kpi_frame.setStyleSheet(
            f"background: {C_SURFACE}; border-radius: 12px; border: 1px solid {C_BORDER};"
        )
        kpi_lay = QHBoxLayout(kpi_frame)
        kpi_lay.setContentsMargins(20, 16, 20, 16)
        kpi_lay.setSpacing(0)

        for i, (label, value, color) in enumerate(kpi_data):
            cell = QWidget()
            cell.setStyleSheet("border: none;")
            cl = QVBoxLayout(cell)
            cl.setSpacing(4)
            v = QLabel(value)
            v.setStyleSheet(
                f"color: {color}; font-size: 28px; font-weight: 800; border: none;"
            )
            v.setAlignment(Qt.AlignmentFlag.AlignCenter)
            cl.addWidget(v)
            n = QLabel(label)
            n.setStyleSheet(f"color: {C_MUTED}; font-size: 11px; border: none;")
            n.setAlignment(Qt.AlignmentFlag.AlignCenter)
            cl.addWidget(n)
            kpi_lay.addWidget(cell, stretch=1)
            if i < len(kpi_data) - 1:
                div = QFrame()
                div.setFrameShape(QFrame.Shape.VLine)
                div.setStyleSheet(f"color: {C_BORDER};")
                kpi_lay.addWidget(div)

        lay.addWidget(kpi_frame)

        # ── Info sessione ────────────────────────────────────────────────────
        info_frame = QFrame()
        info_frame.setStyleSheet(
            f"background: {C_SURFACE}; border-radius: 12px; border: 1px solid {C_BORDER};"
        )
        info_lay = QGridLayout(info_frame)
        info_lay.setContentsMargins(20, 16, 20, 16)
        info_lay.setSpacing(10)

        def _info_row(grid, row, label, value):
            lbl = QLabel(label)
            lbl.setStyleSheet(f"color: {C_MUTED}; border: none;")
            val = QLabel(str(value))
            val.setStyleSheet(f"color: {C_TEXT}; font-weight: 600; border: none;")
            grid.addWidget(lbl, row, 0)
            grid.addWidget(val, row, 1)

        _info_row(info_lay, 0, "Nome sessione", self.session_name)
        _info_row(info_lay, 1, "Data", session_date or "—")
        _info_row(info_lay, 2, "File Emotiv",
                  Path(self.emotiv_file).name if self.emotiv_file else "Non disponibile")
        _info_row(info_lay, 3, "Qualità dati EEG",
                  f"{met_count} campioni MET — "
                  + ("sufficienti" if met_count >= 20 else
                     "scarsi (tieni ogni immagine almeno 8-10 s)"))

        lay.addWidget(info_frame)

        # ── Tabella riepilogo immagini ────────────────────────────────────────
        if self.windows:
            tbl_frame = QFrame()
            tbl_frame.setStyleSheet(
                f"background: {C_SURFACE}; border-radius: 12px; border: 1px solid {C_BORDER};"
            )
            tbl_lay = QVBoxLayout(tbl_frame)
            tbl_lay.setContentsMargins(16, 14, 16, 14)
            tbl_lay.setSpacing(8)

            hdr_lbl = QLabel("Riepilogo immagini")
            hdr_lbl.setStyleSheet(
                f"color: {C_TEXT}; font-size: 13px; font-weight: 700; border: none;"
            )
            tbl_lay.addWidget(hdr_lbl)

            # Intestazione tabella
            cols = ["#", "Immagine", "Durata (s)", "Gaze pts",
                    "Campioni EEG", "Att.", "Eng.", "Str."]
            header_row = QHBoxLayout()
            for c in cols:
                l = QLabel(c)
                l.setStyleSheet(
                    f"color: {C_MUTED}; font-size: 11px;"
                    f" font-weight: 600; border: none;"
                )
                l.setAlignment(Qt.AlignmentFlag.AlignCenter)
                header_row.addWidget(l, stretch=2 if c == "Immagine" else 1)
            tbl_lay.addLayout(header_row)
            tbl_lay.addWidget(_sep())

            for i, win in enumerate(self.windows):
                gaze_pts = len(self.points_per_image[i]) \
                           if i < len(self.points_per_image) else 0
                metrics  = _avg_metrics(self.df_perf, win["t_start"], win["t_end"])
                sub_met  = _filter_window(self.df_perf, win["t_start"], win["t_end"])
                img_name = Path(self.image_paths[i]).stem \
                           if i < len(self.image_paths) else win["label"]

                row_lay = QHBoxLayout()
                def _cell(txt, color=C_TEXT, bold=False):
                    l = QLabel(str(txt))
                    l.setStyleSheet(
                        f"color: {color}; border: none;"
                        + (" font-weight: 700;" if bold else "")
                    )
                    l.setAlignment(Qt.AlignmentFlag.AlignCenter)
                    return l

                row_lay.addWidget(_cell(i + 1, C_MUTED), stretch=1)
                row_lay.addWidget(_cell(img_name[:22], C_TEXT, bold=True), stretch=2)
                row_lay.addWidget(_cell(
                    win["duration_s"] if win["duration_s"] else "—"), stretch=1)
                row_lay.addWidget(_cell(f"{gaze_pts:,}", C_GREEN), stretch=1)
                row_lay.addWidget(_cell(len(sub_met) if not sub_met.empty else 0,
                                        "#f1c40f"), stretch=1)
                row_lay.addWidget(_cell(
                    f"{metrics.get('attention', 0):.2f}"
                    if metrics.get("attention") is not None else "—",
                    "#4f8ef7"), stretch=1)
                row_lay.addWidget(_cell(
                    f"{metrics.get('eng', 0):.2f}"
                    if metrics.get("eng") is not None else "—",
                    "#2ecc71"), stretch=1)
                row_lay.addWidget(_cell(
                    f"{metrics.get('str', 0):.2f}"
                    if metrics.get("str") is not None else "—",
                    "#e74c3c"), stretch=1)
                tbl_lay.addLayout(row_lay)

                if i < len(self.windows) - 1:
                    tbl_lay.addWidget(_sep())

            lay.addWidget(tbl_frame)

        lay.addStretch()
        scroll.setWidget(container)
        return scroll

    # ══════════════════════════════════════════════════════════════════════════
    # TAB 2 — ANALISI IMMAGINI
    # ══════════════════════════════════════════════════════════════════════════
    def _tab_images(self):
        container = QWidget()
        lay = QVBoxLayout(container)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(12)

        # Selettore immagine
        sel_row = QHBoxLayout()
        sel_lbl = QLabel("Immagine:")
        sel_lbl.setStyleSheet(f"color: {C_MUTED}; border: none;")
        sel_row.addWidget(sel_lbl)
        self.img_selector = QComboBox()
        for i, p in enumerate(self.image_paths):
            self.img_selector.addItem(f"{i+1}. {Path(p).name}")
        self.img_selector.setFixedWidth(400)
        sel_row.addWidget(self.img_selector)
        sel_row.addStretch()
        lay.addLayout(sel_row)

        # Stack di contenuto per immagine
        self._img_stack = QTabWidget()
        self._img_stack.setTabPosition(QTabWidget.TabPosition.West)
        self._build_image_stack()
        self.img_selector.currentIndexChanged.connect(self._on_img_changed)
        lay.addWidget(self._img_stack, stretch=1)

        return container

    def _build_image_stack(self):
        self._img_stack.clear()
        idx = self.img_selector.currentIndex()
        if idx < 0:
            return

        img_path = self.image_paths[idx] if idx < len(self.image_paths) else None
        pts      = self.points_per_image[idx] if idx < len(self.points_per_image) else []
        win      = self.windows[idx] if idx < len(self.windows) else None

        # ── Gaze Path ───────────────────────────────────────────────────────
        self._img_stack.addTab(
            self._make_gaze(img_path, pts), "Gaze Path"
        )

        # ── Heatmap ─────────────────────────────────────────────────────────
        self._img_stack.addTab(
            self._make_heatmap(img_path, pts), "Heatmap"
        )

        # ── EEG per immagine ─────────────────────────────────────────────────
        self._img_stack.addTab(
            self._make_eeg_image(idx, win), "EEG"
        )

    def _on_img_changed(self, idx):
        self._build_image_stack()

    # ── Gaze Path ─────────────────────────────────────────────────────────────
    def _make_gaze(self, img_path, pts):
        fig    = _dark_fig((8, 5))
        canvas = FigureCanvas(fig)
        ax     = fig.add_subplot(111)
        _style_ax(ax)

        if img_path:
            img = plt.imread(img_path)
            ax.imshow(img, extent=[0, 1, 1, 0], aspect='auto')

        if pts:
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            ax.plot(xs, ys, color='#4f8ef7', alpha=0.5, linewidth=1.2, zorder=1)
            ax.scatter(xs, ys, s=25, c='#4f8ef7', alpha=0.4, zorder=2)
            ax.scatter(xs[0],  ys[0],  s=120, c=C_GREEN, zorder=4, label="Inizio")
            ax.scatter(xs[-1], ys[-1], s=120, c=C_RED,   zorder=4, label="Fine")
            ax.legend(fontsize=9, facecolor=C_SURFACE,
                      labelcolor=C_TEXT, edgecolor=C_BORDER)

        name = Path(img_path).name if img_path else ""
        ax.set_title(f"Gaze Path — {name}", pad=8)
        ax.axis('off')
        fig.tight_layout()
        return canvas

    # ── Heatmap ───────────────────────────────────────────────────────────────
    def _make_heatmap(self, img_path, pts):
        fig    = _dark_fig((8, 5))
        canvas = FigureCanvas(fig)
        ax     = fig.add_subplot(111)
        _style_ax(ax)

        if img_path:
            img = plt.imread(img_path)
            ax.imshow(img, extent=[0, 1, 1, 0], aspect='auto', zorder=0)

        if pts:
            xs = np.array([p[0] for p in pts])
            ys = np.array([p[1] for p in pts])
            h, _, _ = np.histogram2d(xs, ys, bins=80, range=[[0,1],[0,1]])
            ax.imshow(gaussian_filter(h.T, sigma=3), extent=[0,1,1,0],
                      origin='upper', cmap='hot', alpha=0.6,
                      aspect='auto', zorder=1)

        name = Path(img_path).name if img_path else ""
        ax.set_title(f"Heatmap — {name}", pad=8)
        ax.axis('off')
        fig.tight_layout()
        return canvas

    # ── EEG per immagine ──────────────────────────────────────────────────────
    def _make_eeg_image(self, idx, win):
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("border: none;")
        container = QWidget()
        lay = QVBoxLayout(container)
        lay.setSpacing(14)
        lay.setContentsMargins(8, 8, 8, 8)

        img_name = Path(self.image_paths[idx]).stem \
                   if idx < len(self.image_paths) else f"Immagine {idx+1}"

        # Info immagine
        info = QLabel(
            f"<b>{img_name}</b>"
            + (f"  ·  {win['duration_s']} s" if win and win['duration_s'] else "")
            + (f"  ·  marker: <span style='color:{C_MUTED}'>"
               f"{win['label']}</span>" if win else "")
        )
        info.setStyleSheet(f"color: {C_TEXT}; font-size: 13px; border: none;")
        info.setTextFormat(Qt.TextFormat.RichText)
        lay.addWidget(info)

        if win is None:
            lay.addWidget(QLabel("Marker non trovato per questa immagine."))
            lay.addStretch()
            scroll.setWidget(container)
            return scroll

        metrics = _avg_metrics(self.df_perf, win["t_start"], win["t_end"])
        bands   = _avg_bands(self.df_pow,   win["t_start"], win["t_end"])
        sub_met = _filter_window(self.df_perf, win["t_start"], win["t_end"])

        # Card metriche
        if metrics:
            lay.addWidget(self._metrics_card(metrics))
        else:
            no = QLabel("Nessun campione Performance per questa immagine.")
            no.setStyleSheet(f"color: {C_MUTED}; border: none;")
            lay.addWidget(no)

        # Grafico bande
        if bands:
            lay.addWidget(self._bands_chart(bands, img_name))
        else:
            no2 = QLabel("Nessun campione BandPower per questa immagine.")
            no2.setStyleSheet(f"color: {C_MUTED}; border: none;")
            lay.addWidget(no2)

        # Time series metriche
        if not sub_met.empty:
            lay.addWidget(self._metrics_timeseries(sub_met, img_name))

        lay.addStretch()
        scroll.setWidget(container)
        return scroll

    def _metrics_card(self, metrics):
        frame = QFrame()
        frame.setStyleSheet(
            f"QFrame {{ background: {C_SURFACE}; border-radius: 12px;"
            f" border: 1px solid {C_BORDER}; }}"
        )
        grid = QGridLayout(frame)
        grid.setContentsMargins(16, 14, 16, 14)
        grid.setSpacing(10)

        title = QLabel("Metriche mentali medie")
        title.setStyleSheet(
            f"color: {C_TEXT}; font-size: 12px; font-weight: 700; border: none;"
        )
        grid.addWidget(title, 0, 0, 1, len(PERF_LABELS))

        col = 0
        for key, (ltext, color) in PERF_LABELS.items():
            val = metrics.get(key)
            if val is None:
                col += 1
                continue
            cell = QFrame()
            cell.setStyleSheet(
                f"QFrame {{ background: {C_BG}; border-radius: 8px;"
                f" border: 1px solid {C_BORDER}; }}"
            )
            cl = QVBoxLayout(cell)
            cl.setContentsMargins(10, 8, 10, 8)
            cl.setSpacing(3)
            v_lbl = QLabel(f"{val:.2f}")
            v_lbl.setStyleSheet(
                f"color: {color}; font-size: 20px;"
                f" font-weight: 800; border: none;"
            )
            v_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            cl.addWidget(v_lbl)
            n_lbl = QLabel(ltext)
            n_lbl.setStyleSheet(
                f"color: {C_MUTED}; font-size: 10px; border: none;"
            )
            n_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            cl.addWidget(n_lbl)
            grid.addWidget(cell, 1, col)
            col += 1

        return frame

    def _bands_chart(self, bands, title_str):
        fig    = _dark_fig((7, 2.5))
        canvas = FigureCanvas(fig)
        ax     = fig.add_subplot(111)
        _style_ax(ax)

        names  = list(bands.keys())
        values = list(bands.values())
        colors = [BAND_COLORS.get(n, "#4f8ef7") for n in names]
        bars   = ax.bar(names, values, color=colors, width=0.5, edgecolor="none")
        mx     = max(values) if values else 1
        for bar, val in zip(bars, values):
            ax.text(bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + mx * 0.02,
                    f"{val:.4f}", ha='center', va='bottom',
                    color=C_TEXT, fontsize=8)

        ax.set_title(f"Onde cerebrali — {title_str}", pad=6)
        ax.set_ylabel("Potenza (µV²)")
        ax.set_ylim(0, mx * 1.25)
        ax.grid(axis='y', color=C_BORDER, linestyle='--', alpha=0.4)
        fig.tight_layout()
        return canvas

    def _metrics_timeseries(self, df, title_str):
        metric_cols = [c for c in PERF_COL_MAP.values()
                       if c in df.columns
                       and pd.api.types.is_numeric_dtype(df[c])]
        if not metric_cols or "time" not in df.columns:
            return QWidget()

        n_metrics = len(metric_cols)
        # Altezza proporzionale al numero di metriche
        fig    = _dark_fig((9, max(3.5, n_metrics * 0.8)))
        canvas = FigureCanvas(fig)

        # Un subplot per ogni metrica — così non si sovrappongono mai
        axes = fig.subplots(n_metrics, 1, sharex=True)
        if n_metrics == 1:
            axes = [axes]

        colors = ['#4f8ef7', '#2ecc71', '#e74c3c', '#f1c40f', '#9b59b6',
                  '#e67e22', '#1abc9c']

        t      = df["time"].values
        t_norm = t - t[0]

        for i, (col, ax) in enumerate(zip(metric_cols, axes)):
            _style_ax(ax)
            label  = PERF_LABELS.get(col, (col,))[0]
            color  = colors[i % len(colors)]
            values = df[col].values

            ax.plot(t_norm, values, color=color, linewidth=2.0)
            ax.fill_between(t_norm, values, alpha=0.15, color=color)

            # Etichetta metrica a sinistra
            ax.set_ylabel(label, color=color, fontsize=9, fontweight='bold',
                          rotation=0, labelpad=60, va='center')

            # Valore medio come annotazione
            mean_val = float(np.mean(values))
            ax.axhline(mean_val, color=color, linestyle='--',
                       alpha=0.4, linewidth=1)
            ax.text(t_norm[-1] + 0.3, mean_val,
                    f"avg {mean_val:.2f}",
                    color=color, fontsize=8, va='center')

            ax.set_ylim(-0.05, 1.15)
            ax.grid(True, color=C_BORDER, linestyle='--', alpha=0.25)
            ax.tick_params(axis='y', labelsize=7)

            if i == 0:
                ax.set_title(f"Andamento metriche — {title_str}",
                             color=C_TEXT, pad=6)

        axes[-1].set_xlabel("Tempo (s)", color=C_MUTED)
        fig.tight_layout()
        return canvas

    # ══════════════════════════════════════════════════════════════════════════
    # TAB 3 — ANALISI AVANZATA
    # ══════════════════════════════════════════════════════════════════════════
    def _tab_advanced(self):
        container = QWidget()
        lay = QVBoxLayout(container)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(8)

        inner = QTabWidget()
        lay.addWidget(inner)

        # Performance completa
        if self.df_perf is not None:
            inner.addTab(self._adv_performance(), "Performance sessione")

        # BandPower completa
        if self.df_pow is not None:
            inner.addTab(self._adv_bandpower(), "BandPower sessione")

        # Markers raw
        if self.markers:
            inner.addTab(self._adv_markers(), "Markers")

        return container

    def _adv_performance(self):
        fig    = _dark_fig((9, 4))
        canvas = FigureCanvas(fig)
        ax     = fig.add_subplot(111)
        _style_ax(ax)

        metric_cols = [c for c in PERF_COL_MAP.values()
                       if c in self.df_perf.columns
                       and pd.api.types.is_numeric_dtype(self.df_perf[c])]

        if "time" in self.df_perf.columns and metric_cols:
            from collections import defaultdict
            t      = self.df_perf["time"].values
            t_norm = t - t[0]

            # Raggruppa le colonne con lo stesso valore medio (sovrapposte)
            #  piccolo offset verticale a ciascuna per la sovrapposizione
            STEP = 0.018
            groups = defaultdict(list)
            for col in metric_cols:
                key = round(float(self.df_perf[col].mean()), 4)
                groups[key].append(col)

            col_offsets = {}
            for key, cols_group in groups.items():
                n = len(cols_group)
                offsets = [STEP * (i - (n - 1) / 2) for i in range(n)]
                for col, off in zip(cols_group, offsets):
                    col_offsets[col] = off

            lines = []
            for col in metric_cols:
                ltext, color = PERF_LABELS.get(col, (col, "#aaaaaa"))
                vals    = self.df_perf[col].values + col_offsets.get(col, 0)
                is_flat = float(np.std(self.df_perf[col].values)) < 1e-6
                ls      = '--' if is_flat else '-'
                lw      = 2.0 if is_flat else 1.6
                line,   = ax.plot(t_norm, vals, label=ltext, color=color,
                                  linewidth=lw, linestyle=ls)
                lines.append(line)

            # Linee verticali marker slide
            for m in self.markers:
                mk = str(m.get("label", ""))
                if mk.startswith("slide_"):
                    t_mk = float(m["time"]) - t[0]
                    if 0 <= t_mk <= t_norm[-1]:
                        ax.axvline(t_mk, color='white', alpha=0.25,
                                   linestyle='--', linewidth=1)
                        num = mk.split("_")[1]
                        ax.text(t_mk + 0.2, ax.get_ylim()[1] * 0.92,
                                f"S{num}", color='white', fontsize=7, alpha=0.6)

            ax.set_xlabel("Tempo (s)")
            ax.legend(handles=lines, fontsize=8, facecolor=C_SURFACE,
                      labelcolor=C_TEXT, edgecolor=C_BORDER,
                      loc='upper left', bbox_to_anchor=(1.01, 1), borderaxespad=0)
            ax.grid(True, color=C_BORDER, linestyle='--', alpha=0.3)

            # Nota se ci sono linee separate artificialmente
            if any(len(g) > 1 for g in groups.values()):
                ax.text(0.01, 0.02,
                        "* linee con stesso valore separate verticalmente per leggibilità",
                        transform=ax.transAxes, fontsize=7, color=C_MUTED, va='bottom')

        ax.set_title("Metriche mentali — sessione completa", pad=8)
        fig.tight_layout(rect=[0, 0, 0.82, 1])
        return canvas

    def _adv_bandpower(self):
        fig    = _dark_fig((9, 4))
        canvas = FigureCanvas(fig)
        ax     = fig.add_subplot(111)
        _style_ax(ax)

        if "time" in self.df_pow.columns:
            t      = self.df_pow["time"].values
            t_norm = t - t[0]
            for band, color in BAND_COLORS.items():
                cols = [c for c in self.df_pow.columns if c.endswith("/" + band)]
                if cols:
                    avg      = self.df_pow[cols].mean(axis=1)
                    smoothed = avg.rolling(window=5, min_periods=1).mean()
                    ax.plot(t_norm, smoothed, label=band.upper(),
                            color=color, linewidth=1.8)
            ax.set_xlabel("Tempo (s)")
            ax.set_ylabel("Potenza (µV²)")
            ax.legend(fontsize=8, facecolor=C_SURFACE,
                      labelcolor=C_TEXT, edgecolor=C_BORDER)
            ax.grid(True, color=C_BORDER, linestyle='--', alpha=0.3)

        ax.set_title("Bande di frequenza — sessione completa", pad=8)
        fig.tight_layout()
        return canvas

    def _adv_markers(self):
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("border: none;")
        container = QWidget()
        lay = QVBoxLayout(container)
        lay.setSpacing(6)
        lay.setContentsMargins(8, 8, 8, 8)

        hdr = QLabel("Foglio Markers — tutti gli eventi registrati")
        hdr.setStyleSheet(
            f"color: {C_TEXT}; font-size: 13px; font-weight: 700; border: none;"
        )
        lay.addWidget(hdr)

        # Intestazione
        row = QHBoxLayout()
        for h, w in [("Timestamp", 2), ("Label", 3), ("Δ dal precedente", 2)]:
            l = QLabel(h)
            l.setStyleSheet(
                f"color: {C_MUTED}; font-size: 11px; font-weight: 600; border: none;"
            )
            row.addWidget(l, stretch=w)
        lay.addLayout(row)
        lay.addWidget(_sep())

        prev_t = None
        for m in self.markers:
            t     = float(m["time"])
            label = str(m["label"])
            delta = f"+{round(t - prev_t, 2)} s" if prev_t else "—"
            prev_t = t

            row = QHBoxLayout()
            for txt, color, w in [
                (f"{t:.3f}", C_MUTED, 2),
                (label,      C_TEXT,  3),
                (delta,      C_GREEN, 2),
            ]:
                l = QLabel(txt)
                l.setStyleSheet(f"color: {color}; border: none;")
                row.addWidget(l, stretch=w)
            lay.addLayout(row)

        lay.addStretch()
        scroll.setWidget(container)
        return scroll

    # ══════════════════════════════════════════════════════════════════════════
    # SALVA REPORT PNG
    # ══════════════════════════════════════════════════════════════════════════
    def _save_report(self):
        path, _ = QFileDialog.getSaveFileName(
            self, "Salva report",
            str(DATA_DIR / f"{self.session_name}_report.png"),
            "PNG (*.png)"
        )
        if not path:
            return

        n   = len(self.image_paths)
        fig = Figure(figsize=(10 * n, 10), dpi=100)
        fig.patch.set_facecolor(C_BG)
        canvas = FigureCanvasAgg(fig)

        for i, img_path in enumerate(self.image_paths):
            pts  = self.points_per_image[i] if i < len(self.points_per_image) else []
            img  = plt.imread(img_path)
            name = Path(img_path).stem
            win  = self.windows[i] if i < len(self.windows) else None

            # Gaze Path
            ax1 = fig.add_subplot(3, n, i + 1)
            ax1.set_facecolor(C_BG)
            ax1.imshow(img, extent=[0,1,1,0], aspect='auto')
            if pts:
                xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                ax1.plot(xs, ys, color='#4f8ef7', alpha=0.5, linewidth=1.2)
                ax1.scatter(xs[0],  ys[0],  s=80, c=C_GREEN, zorder=5)
                ax1.scatter(xs[-1], ys[-1], s=80, c=C_RED,   zorder=5)
            ax1.set_title(f"Gaze\n{name}", color=C_TEXT, fontsize=9)
            ax1.axis('off')

            # Heatmap
            ax2 = fig.add_subplot(3, n, n + i + 1)
            ax2.set_facecolor(C_BG)
            ax2.imshow(img, extent=[0,1,1,0], aspect='auto', zorder=0)
            if pts:
                xs = np.array([p[0] for p in pts])
                ys = np.array([p[1] for p in pts])
                h, _, _ = np.histogram2d(xs, ys, bins=60, range=[[0,1],[0,1]])
                ax2.imshow(gaussian_filter(h.T, sigma=3), extent=[0,1,1,0],
                           origin='upper', cmap='hot', alpha=0.6,
                           aspect='auto', zorder=1)
            ax2.set_title(f"Heatmap\n{name}", color=C_TEXT, fontsize=9)
            ax2.axis('off')

            # EEG
            ax3 = fig.add_subplot(3, n, 2*n + i + 1)
            ax3.set_facecolor(C_BG)
            _style_ax(ax3)
            if win:
                metrics = _avg_metrics(self.df_perf, win["t_start"], win["t_end"])
                if metrics:
                    lbls = []; vals = []; clrs = []
                    for key, (lt, col) in PERF_LABELS.items():
                        v = metrics.get(key)
                        if v is not None:
                            lbls.append(lt); vals.append(v); clrs.append(col)
                    if vals:
                        ax3.bar(lbls, vals, color=clrs, edgecolor='none', width=0.5)
                        ax3.set_ylim(0, max(vals) * 1.3)
                        ax3.tick_params(axis='x', rotation=30, labelsize=7)
                else:
                    ax3.text(0.5, 0.5, "No EEG data", color=C_MUTED,
                             ha='center', va='center', transform=ax3.transAxes)
            ax3.set_title(f"EEG medio\n{name}", color=C_TEXT, fontsize=9)

        fig.suptitle(self.session_name, color=C_TEXT, fontsize=14, y=0.01)
        fig.tight_layout(pad=2)
        canvas.draw()
        fig.savefig(path, dpi=100, bbox_inches='tight', facecolor=C_BG)
        QMessageBox.information(self, "Salvato", f"Report salvato:\n{path}")
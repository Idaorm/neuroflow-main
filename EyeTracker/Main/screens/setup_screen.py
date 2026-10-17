import csv
import os
from pathlib import Path
from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QLabel, QHBoxLayout,
                              QLineEdit, QFileDialog, QMessageBox, QScrollArea,
                              QProgressDialog)
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QPixmap

from config import (C_SURFACE, C_BORDER, C_TEXT, C_MUTED, C_BG, C_GREEN,
                    C_ACCENT, C_RED, DATA_DIR, styled_btn)

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"}

SEARCH_ROOTS = [
    Path.home() / "Desktop",
    Path.home() / "Downloads",
    Path.home() / "Pictures",
    Path.home() / "Documents",
    Path.home(),
]


def _find_image(stem, extra_roots=None):
    roots = list(SEARCH_ROOTS)
    if extra_roots:
        roots = list(extra_roots) + roots

    for root in roots:
        if not root.exists():
            continue
        # Cerca ricorsivamente tutti i file immagine e confronta il nome
        for candidate in root.rglob("*"):
            if (candidate.suffix.lower() in SUPPORTED_EXTENSIONS and
                    candidate.stem.lower() == stem.lower()):
                return str(candidate)
    return None


def _images_from_excel(excel_path):
    try:
        import pandas as pd
        df = pd.read_excel(excel_path, sheet_name="Markers")
        markers = df[["time", "label"]].dropna().to_dict("records")
    except Exception as e:
        return [], f"Impossibile leggere il foglio Markers: {e}"

    slides = []
    for m in markers:
        label = str(m.get("label", ""))
        if not label.startswith("slide_"):
            continue
        parts = label.split("_", 2)
        if len(parts) < 3:
            continue
        try:
            idx  = int(parts[1])
            stem = parts[2]
        except ValueError:
            continue
        slides.append((idx, stem))

    if not slides:
        return [], "Nessun marker slide_ trovato nel foglio Markers."

    slides.sort(key=lambda x: x[0])

    results = []
    missing = []
    for idx, stem in slides:
        path = _find_image(stem, extra_roots=[DATA_DIR])
        if path:
            results.append((idx, stem, path))
        else:
            missing.append(stem)
            results.append((idx, stem, None))

    return results, missing


def _load_tobii_csv(csv_path):
    pts = []
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if len(row) >= 3:
                    try:
                        x = float(row[0].replace(",", "."))
                        y = float(row[1].replace(",", "."))
                        t = float(row[2])
                        if 0 <= x <= 1 and 0 <= y <= 1:
                            pts.append((x, y, t))
                    except ValueError:
                        continue
    except Exception as e:
        print(f"[Tobii CSV] Errore: {e}")
    return pts


class SetupScreen(QWidget):
    def __init__(self, on_start, on_aggregate, on_analyze=None):
        super().__init__()
        self.on_start     = on_start
        self.on_aggregate = on_aggregate
        self.on_analyze   = on_analyze
        self.image_paths  = []
        self._build()

    def _build(self):
        outer = QVBoxLayout(self)
        outer.setAlignment(Qt.AlignmentFlag.AlignCenter)

        card = QWidget()
        card.setFixedWidth(620)
        card.setStyleSheet(
            f"background: {C_SURFACE}; border-radius: 16px; border: 1px solid {C_BORDER};"
        )
        layout = QVBoxLayout(card)
        layout.setSpacing(16)
        layout.setContentsMargins(40, 30, 40, 30)

        title = QLabel("  Eye Tracker")
        title.setStyleSheet(
            f"font-size: 26px; font-weight: 700; color: {C_TEXT}; border: none;"
        )
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title)

        sub = QLabel("Seleziona le immagini stimolo per la registrazione")
        sub.setStyleSheet(f"color: {C_MUTED}; font-size: 12px; border: none;")
        sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub.setWordWrap(True)
        layout.addWidget(sub)

        btn_row = QHBoxLayout()
        btn_select_files = styled_btn("  Seleziona immagini", C_BORDER, C_TEXT)
        btn_select_files.setToolTip("Scegli uno o più file immagine singoli")
        btn_select_files.clicked.connect(self._load_images)
        btn_row.addWidget(btn_select_files)

        btn_select_folder = styled_btn("  Seleziona cartella", C_BORDER, C_TEXT)
        btn_select_folder.setToolTip("Carica tutte le immagini da una cartella")
        btn_select_folder.clicked.connect(self._load_folder)
        btn_row.addWidget(btn_select_folder)

        btn_reset = styled_btn("✕  Svuota lista", C_RED, "white")
        btn_reset.setToolTip("Rimuove tutte le immagini selezionate")
        btn_reset.clicked.connect(self._reset_images)
        btn_row.addWidget(btn_reset)
        layout.addLayout(btn_row)

        self.preview_label = QLabel("Nessuna immagine selezionata")
        self.preview_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.preview_label.setStyleSheet(f"color: {C_MUTED}; border: none;")

        self.preview_area = QScrollArea()
        self.preview_area.setFixedHeight(130)
        self.preview_area.setWidgetResizable(True)
        self.preview_area.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAsNeeded
        )
        self.preview_area.setVerticalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )
        self.preview_area.setStyleSheet(
            f"border: 2px dashed {C_BORDER}; border-radius: 10px; background: {C_BG};"
        )
        self.preview_area.setWidget(self.preview_label)
        layout.addWidget(self.preview_area)

        self.count_label = QLabel("")
        self.count_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.count_label.setStyleSheet(
            f"color: {C_MUTED}; font-size: 12px; border: none;"
        )
        layout.addWidget(self.count_label)

        row = QHBoxLayout()
        lbl = QLabel("Sessione:")
        lbl.setStyleSheet("border: none;")
        lbl.setFixedWidth(70)
        self.session_name = QLineEdit()
        self.session_name.setPlaceholderText("es. Paziente_01")
        row.addWidget(lbl)
        row.addWidget(self.session_name)
        layout.addLayout(row)

        self.btn_start = styled_btn("▶  Avvia Registrazione", C_GREEN, "white", "#1a3a2a")
        self.btn_start.setEnabled(False)
        self.btn_start.clicked.connect(self._start)
        layout.addWidget(self.btn_start)

        from PyQt6.QtWidgets import QFrame
        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"color: {C_BORDER}; margin: 4px 0;")
        layout.addWidget(sep)

        lbl_or = QLabel("oppure analizza una sessione già registrata")
        lbl_or.setStyleSheet(f"color: {C_MUTED}; font-size: 11px; border: none;")
        lbl_or.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(lbl_or)

        btn_analyze = styled_btn("  Analizza sessione", "#7c3aed", "white")
        btn_analyze.setToolTip(
            "Carica un file Excel Emotiv e un CSV Tobii per analizzare una sessione passata"
        )
        btn_analyze.clicked.connect(self._analyze_session)
        layout.addWidget(btn_analyze)

        outer.addWidget(card)

    # ── ANALIZZA SESSIONE ─────────────────────────────────────────────────────
    def _analyze_session(self):
        try:
            # 1. Carica Excel Emotiv
            excel_path, _ = QFileDialog.getOpenFileName(
                self, "Seleziona file Excel Emotiv",
                str(DATA_DIR),
                "Excel (*.xlsx *.xls)"
            )
            if not excel_path:
                return

            # 2. Leggi i marker e cerca le immagini
            progress = QProgressDialog("Ricerca immagini dal file Excel...", None, 0, 0, self)
            progress.setWindowModality(Qt.WindowModality.WindowModal)
            progress.show()
            from PyQt6.QtWidgets import QApplication
            QApplication.processEvents()

            results, missing = _images_from_excel(excel_path)
            progress.close()

            print(f"[DEBUG] results: {results}")
            print(f"[DEBUG] missing: {missing}")

            if isinstance(missing, str):
                QMessageBox.critical(self, "Errore", missing)
                return

            if not results:
                QMessageBox.warning(self, "Nessuna immagine",
                                    "Nessun marker slide_ trovato nel file Excel.")
                return

            found     = [(idx, stem, path) for idx, stem, path in results if path]
            not_found = [stem for idx, stem, path in results if not path]

            print(f"[DEBUG] found: {len(found)}, not_found: {not_found}")

            msg = f"Trovate {len(found)} immagini su {len(results)} dai marker.\n"
            if not_found:
                msg += f"\nImmagini non trovate automaticamente ({len(not_found)}):\n"
                msg += "\n".join(f"  • {s}" for s in not_found)
                msg += "\n\nVuoi selezionarle manualmente?"
                reply = QMessageBox.question(
                    self, "Immagini mancanti", msg,
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
                )
                if reply == QMessageBox.StandardButton.Yes:
                    for i, (idx, stem, path) in enumerate(results):
                        if path:
                            continue
                        manual, _ = QFileDialog.getOpenFileName(
                            self,
                            f"Seleziona immagine per: {stem}",
                            str(Path.home()),
                            "Immagini (*.png *.jpg *.jpeg *.bmp *.gif *.webp)"
                        )
                        if manual:
                            results[i] = (idx, stem, manual)

            # 3. Carica CSV Tobii (opzionale)
            csv_reply = QMessageBox.question(
                self, "File Tobii",
                "Vuoi caricare anche il file CSV Tobii (eye tracking)?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )
            tobii_pts  = []
            tobii_path = None
            if csv_reply == QMessageBox.StandardButton.Yes:
                tobii_path, _ = QFileDialog.getOpenFileName(
                    self, "Seleziona CSV Tobii",
                    str(DATA_DIR),
                    "CSV (*.csv)"
                )
                if tobii_path:
                    tobii_pts = _load_tobii_csv(tobii_path)

            # 4. Costruisce image_paths e points_per_image
            image_paths = [path for idx, stem, path in sorted(results) if path]
            print(f"[DEBUG] image_paths finali: {image_paths}")

            if not image_paths:
                QMessageBox.critical(self, "Errore",
                                     "Nessuna immagine disponibile per l'analisi.")
                return

            if tobii_pts:
                try:
                    import pandas as pd
                    df_markers = pd.read_excel(excel_path, sheet_name="Markers")
                    markers    = df_markers[["time", "label"]].dropna().to_dict("records")
                    slide_markers = sorted(
                        [m for m in markers if str(m.get("label", "")).startswith("slide_")],
                        key=lambda m: float(m["time"])
                    )
                    points_per_image = []
                    for i, m in enumerate(slide_markers):
                        t0 = float(m["time"])
                        t1 = float(slide_markers[i+1]["time"]) \
                             if i+1 < len(slide_markers) else float("inf")
                        pts = [(x, y, t) for x, y, t in tobii_pts if t0 <= t < t1]
                        points_per_image.append(pts)
                except Exception as e:
                    print(f"[DEBUG] Errore split punti Tobii: {e}")
                    points_per_image = [tobii_pts] + [[] for _ in range(len(image_paths)-1)]
            else:
                points_per_image = [[] for _ in image_paths]

            # 5. Chiama il callback on_analyze
            session_name = Path(excel_path).stem
            print(f"[DEBUG] Chiamo on_analyze con {len(image_paths)} immagini")
            if self.on_analyze:
                self.on_analyze(
                    image_paths=image_paths,
                    session_name=session_name,
                    points_per_image=points_per_image,
                    emotiv_file=excel_path,
                )

        except Exception as e:
            import traceback
            QMessageBox.critical(self, "Errore inaspettato", traceback.format_exc())
            print(f"[ERROR] {traceback.format_exc()}")

    # ── LOAD IMAGES ──────────────────────────────────────────────────────────
    def _load_images(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Seleziona immagini", str(Path.home()),
            "Immagini (*.png *.jpg *.jpeg *.bmp *.gif *.webp)"
        )
        if paths:
            existing = set(self.image_paths)
            self.image_paths += [p for p in paths if p not in existing]
            self._update_preview()

    def _load_folder(self):
        folder = QFileDialog.getExistingDirectory(
            self, "Seleziona cartella immagini", str(Path.home())
        )
        if folder:
            paths = sorted([
                str(p) for p in Path(folder).iterdir()
                if p.suffix.lower() in SUPPORTED_EXTENSIONS
            ])
            if not paths:
                QMessageBox.warning(self, "Cartella vuota",
                                    "Nessuna immagine trovata nella cartella selezionata.")
                return
            existing = set(self.image_paths)
            self.image_paths += [p for p in paths if p not in existing]
            self._update_preview()

    def _reset_images(self):
        self.image_paths = []
        self.preview_label = QLabel("Nessuna immagine selezionata")
        self.preview_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.preview_label.setStyleSheet(f"color: {C_MUTED}; border: none;")
        self.preview_area.setWidget(self.preview_label)
        self.preview_area.setStyleSheet(
            f"border: 2px dashed {C_BORDER}; border-radius: 10px; background: {C_BG};"
        )
        self.count_label.setText("")
        self.btn_start.setEnabled(False)

    def _update_preview(self):
        container = QWidget()
        container.setStyleSheet(f"background: {C_BG}; border: none;")
        row_layout = QHBoxLayout(container)
        row_layout.setContentsMargins(8, 8, 8, 8)
        row_layout.setSpacing(8)

        for path in self.image_paths[:30]:
            thumb = QLabel()
            pix = QPixmap(path).scaled(
                90, 90,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            thumb.setPixmap(pix)
            thumb.setStyleSheet(
                f"border: 1px solid {C_BORDER}; border-radius: 4px;"
            )
            thumb.setToolTip(Path(path).name)
            row_layout.addWidget(thumb)

        row_layout.addStretch()
        self.preview_area.setWidget(container)
        self.preview_area.setStyleSheet(
            f"border: 2px solid {C_ACCENT}; border-radius: 10px; background: {C_BG};"
        )

        n = len(self.image_paths)
        self.count_label.setText(f"✓ {n} immagini selezionate")
        self.count_label.setStyleSheet(
            f"color: {C_GREEN}; font-size: 12px; font-weight: 600; border: none;"
        )
        self.btn_start.setEnabled(True)

    def _start(self):
        if self.image_paths:
            self.on_start(
                self.image_paths,
                self.session_name.text().strip() or "sessione"
            )
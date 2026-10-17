import time
from pathlib import Path
from PyQt6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QApplication
from PyQt6.QtCore import Qt, QTimer, QObject, QEvent
from PyQt6.QtGui import QPixmap
from config import C_RED, C_BG


class GlobalKeyFilter(QObject):
    def __init__(self, on_right):
        super().__init__()
        self.on_right = on_right

    def eventFilter(self, obj, event):
        if event.type() == QEvent.Type.KeyPress:
            if event.key() == Qt.Key.Key_Right:
                self.on_right()
                return True
        return False


class RecordingScreen(QWidget):
    def __init__(self, image_paths, on_stop, on_marker=None):
        super().__init__()
        self.image_paths = image_paths
        self.on_stop = on_stop
        self.on_marker = on_marker
        self.current_index = 0
        self._elapsed = 0
        # Il tempo della prima immagine viene registrato subito
        self.marker_times = [time.time()]

        self._key_filter = GlobalKeyFilter(self._next_image)
        QApplication.instance().installEventFilter(self._key_filter)

        self._build()

        # Manda subito il marker per la prima immagine
        if self.on_marker and self.image_paths:
            nome = Path(self.image_paths[0]).stem
            self.on_marker(f"slide_1_{nome}", self.marker_times[0])

        self._timer = QTimer()
        self._timer.timeout.connect(self._tick)
        self._timer.start(1000)

    def _build(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        bar = QWidget()
        bar.setFixedHeight(52)
        bar.setStyleSheet(f"background: {C_RED};")
        bar_layout = QHBoxLayout(bar)
        bar_layout.setContentsMargins(20, 0, 20, 0)

        dot = QLabel("●")
        dot.setStyleSheet("color: white; font-size: 10px; border: none;")
        bar_layout.addWidget(dot)

        self.rec_label = QLabel("REC  00:00")
        self.rec_label.setStyleSheet(
            "color: white; font-size: 14px; font-weight: bold;"
            " letter-spacing: 1px; border: none;"
        )
        bar_layout.addWidget(self.rec_label)
        bar_layout.addStretch()

        self.slide_label = QLabel(self._slide_text())
        self.slide_label.setStyleSheet(
            "color: white; font-size: 13px; font-weight: 600; border: none;"
        )
        bar_layout.addWidget(self.slide_label)
        bar_layout.addStretch()

        hint = QLabel("→  prossima immagine")
        hint.setStyleSheet(
            "color: rgba(255,255,255,0.6); font-size: 12px; border: none;"
        )
        bar_layout.addWidget(hint)

        self.btn_stop = QPushButton("  Termina Registrazione")
        self.btn_stop.setStyleSheet(
            "background: white; color: #c0392b; font-weight: bold;"
            " padding: 8px 20px; border-radius: 6px; border: none;"
        )
        self.btn_stop.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_stop.clicked.connect(self._stop)
        bar_layout.addWidget(self.btn_stop)

        layout.addWidget(bar)

        self.img_label = QLabel()
        self.img_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.img_label.setStyleSheet("background: black;")
        layout.addWidget(self.img_label, stretch=1)

        self._refresh_image()

    def _slide_text(self):
        return f"Immagine {self.current_index + 1} / {len(self.image_paths)}"

    def _tick(self):
        self._elapsed += 1
        m, s = divmod(self._elapsed, 60)
        self.rec_label.setText(f"REC  {m:02d}:{s:02d}")

    def _next_image(self):
        if self.current_index < len(self.image_paths) - 1:
            t = time.time()
            self.current_index += 1
            self.marker_times.append(t)
            self.slide_label.setText(self._slide_text())
            self._refresh_image()
            if self.on_marker:
                nome = Path(self.image_paths[self.current_index]).stem
                self.on_marker(f"slide_{self.current_index + 1}_{nome}", t)
        else:
            self._stop()

    def _stop(self):
        QApplication.instance().removeEventFilter(self._key_filter)
        self.btn_stop.setEnabled(False)
        self.btn_stop.setText("Salvataggio in corso...")
        self._timer.stop()
        self.on_stop(self.marker_times)

    def _refresh_image(self):
        if not self.image_paths:
            return
        pix = QPixmap(self.image_paths[self.current_index])
        screen = QApplication.primaryScreen().size()
        pix = pix.scaled(
            screen.width(), screen.height() - 52,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation
        )
        self.img_label.setPixmap(pix)

    def resizeEvent(self, event):
        self._refresh_image()
        super().resizeEvent(event)
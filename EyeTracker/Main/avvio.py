import sys
import traceback
from PyQt6.QtWidgets import QApplication
from ui import MainWindow

def exception_hook(exctype, value, tb):
    print("ERRORE NON GESTITO:")
    traceback.print_exception(exctype, value, tb)
    sys.exit(1)

sys.excepthook = exception_hook

app = QApplication(sys.argv)
app.setStyle("Fusion")
window = MainWindow()
window.show()
sys.exit(app.exec())
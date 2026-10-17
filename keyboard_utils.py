import time

from pynput import keyboard


KEY_RIGHT = "right"
KEY_SPACE = "space"
KEY_PAGE_DOWN = "page_down"


def normalize_key(key):
    """
    Convert pynput keys into platform-independent NeuroFlow key names.
    """
    mapping = {
        keyboard.Key.right: KEY_RIGHT,
        keyboard.Key.space: KEY_SPACE,
        keyboard.Key.page_down: KEY_PAGE_DOWN,
    }

    return mapping.get(key)


class GlobalKeyboardListener:
    """
    Cross-platform global keyboard listener based on pynput.

    The callback receives:

        callback(key_name, event_time)

    where event_time is a Unix timestamp captured as soon as the
    keyboard event reaches the listener.
    """

    def __init__(self, callback, allowed_keys=None):
        self.callback = callback
        self.allowed_keys = (
            set(allowed_keys)
            if allowed_keys is not None
            else None
        )
        self._listener = None

    def _on_press(self, key):
        key_name = normalize_key(key)

        if key_name is None:
            return

        if (
            self.allowed_keys is not None
            and key_name not in self.allowed_keys
        ):
            return

        event_time = time.time()
        self.callback(key_name, event_time)

    def start(self):
        if self._listener is not None:
            return False

        self._listener = keyboard.Listener(
            on_press=self._on_press
        )

        self._listener.start()
        return True

    def stop(self):
        if self._listener is None:
            return

        self._listener.stop()
        self._listener = None

    @property
    def running(self):
        return self._listener is not None

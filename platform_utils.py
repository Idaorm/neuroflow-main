import os
import platform
import subprocess
import webbrowser
import psutil
from pathlib import Path


def get_venv_python(venv_dir):
    """
    Return the Python executable inside a virtual environment.

    macOS/Linux:
        .venv/bin/python

    Windows:
        .venv/Scripts/python.exe
    """
    venv_dir = Path(venv_dir)

    if os.name == "nt":
        return str(venv_dir / "Scripts" / "python.exe")

    return str(venv_dir / "bin" / "python")


def open_url(url):
    """Open a URL with the system default browser."""
    webbrowser.open(url)


def open_path(path):
    """
    Open a file or directory with the operating system default application.
    """
    path = str(Path(path).expanduser().resolve())
    system = platform.system()

    if system == "Windows":
        os.startfile(path)

    elif system == "Darwin":
        subprocess.Popen(["open", path])

    else:
        subprocess.Popen(["xdg-open", path])



def kill_processes_on_ports(*ports):
    """
    Terminate processes listening on the specified TCP ports.

    Works on macOS, Windows and Linux through psutil.
    Processes that cannot be inspected because of OS permissions
    are skipped instead of aborting the whole scan.
    """
    target_ports = {int(port) for port in ports}
    current_pid = os.getpid()
    processes_to_stop = []

    for process in psutil.process_iter(["pid", "name"]):
        if process.pid == current_pid:
            continue

        try:
            connections = process.net_connections(kind="tcp")
        except (
            psutil.NoSuchProcess,
            psutil.AccessDenied,
            psutil.ZombieProcess,
        ):
            continue

        is_listener = any(
            conn.laddr
            and conn.laddr.port in target_ports
            and conn.status == psutil.CONN_LISTEN
            for conn in connections
        )

        if not is_listener:
            continue

        try:
            print(
                f"[Platform] Stopping PID {process.pid} "
                f"({process.name()}) on target port"
            )
            process.terminate()
            processes_to_stop.append(process)

        except (
            psutil.NoSuchProcess,
            psutil.AccessDenied,
            psutil.ZombieProcess,
        ):
            pass

    if not processes_to_stop:
        return

    _, alive = psutil.wait_procs(
        processes_to_stop,
        timeout=2
    )

    for process in alive:
        try:
            process.kill()
        except (
            psutil.NoSuchProcess,
            psutil.AccessDenied,
            psutil.ZombieProcess,
        ):
            pass


def terminate_process_tree(process, timeout=3):
    """
    Terminate a subprocess and all of its descendants.

    Works on macOS, Windows and Linux through psutil.
    """
    if process is None:
        return

    try:
        if process.poll() is not None:
            return
    except Exception:
        pass

    try:
        parent = psutil.Process(process.pid)
    except (
        psutil.NoSuchProcess,
        psutil.AccessDenied,
        psutil.ZombieProcess,
    ):
        return

    try:
        children = parent.children(recursive=True)
    except (
        psutil.NoSuchProcess,
        psutil.AccessDenied,
        psutil.ZombieProcess,
    ):
        children = []

    targets = children + [parent]

    for child in children:
        try:
            child.terminate()
        except (
            psutil.NoSuchProcess,
            psutil.AccessDenied,
            psutil.ZombieProcess,
        ):
            pass

    try:
        parent.terminate()
    except (
        psutil.NoSuchProcess,
        psutil.AccessDenied,
        psutil.ZombieProcess,
    ):
        pass

    _, alive = psutil.wait_procs(
        targets,
        timeout=timeout,
    )

    for target in alive:
        try:
            target.kill()
        except (
            psutil.NoSuchProcess,
            psutil.AccessDenied,
            psutil.ZombieProcess,
        ):
            pass

    if alive:
        psutil.wait_procs(
            alive,
            timeout=1,
        )

    try:
        process.wait(timeout=1)
    except Exception:
        pass


def get_documents_dir():
    """
    Return the user's Documents directory.

    On Windows, read the configured Documents known-folder path
    from the registry so redirected/OneDrive folders are respected.
    On macOS/Linux, fall back to ~/Documents.
    """
    if os.name == "nt":
        try:
            import winreg

            key_path = (
                r"Software\Microsoft\Windows\CurrentVersion"
                r"\Explorer\User Shell Folders"
            )

            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                key_path,
            ) as key:
                value, _ = winreg.QueryValueEx(
                    key,
                    "Personal",
                )

            return Path(
                os.path.expandvars(value)
            ).expanduser()

        except (OSError, ImportError):
            pass

    return Path.home() / "Documents"


def get_neuroflow_data_dir():
    """
    Return the directory used for NeuroFlow session data.
    """
    return get_documents_dir() / "NeuroTech_Data"

"""Create the small mixed-media fixture in a new directory; requires ffmpeg."""
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=False)
(root / "empty" / "nested").mkdir(parents=True)
for extension in ("jpg", "png", "webp", "gif", "bmp", "tiff"):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=128x96",
                    "-frames:v", "1", "-threads", "1", str(root / f"image.{extension}")], check=True)
for extension in ("mp4", "m4v", "mov", "mkv", "webm", "avi"):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=128x96:r=4",
                    "-t", "1", "-c:v", "libvpx" if extension == "webm" else "mpeg4", "-threads", "1",
                    "-f", {"m4v": "mp4", "mkv": "matroska"}.get(extension, extension),
                    str(root / f"video.{extension}")], check=True)
(root / "broken.jpg").write_text("not a photo")
(root / "unsupported.heic").write_text("unsupported")

#!/usr/bin/env bash
# Free public downloads; no accounts, keys or paid inference. Installs nothing system-wide.
set -euo pipefail
voice_tools_dir="${VOICE_TOOLS_DIR:-$PWD/.local/voice}"
command -v cmake >/dev/null
command -v c++ >/dev/null
command -v ffmpeg >/dev/null
if [[ "$(uname)" != Darwin ]]; then command -v espeak-ng >/dev/null; fi
mkdir -p "$voice_tools_dir/models"
if [[ ! -d "$voice_tools_dir/whisper.cpp/.git" ]]; then
  git clone --depth 1 --branch v1.8.2 https://github.com/ggml-org/whisper.cpp.git "$voice_tools_dir/whisper.cpp"
fi
if [[ "$(git -C "$voice_tools_dir/whisper.cpp" rev-parse HEAD)" != 4979e04f5dcaccb36057e059bbaed8a2f5288315 ]]; then
  echo 'Unexpected whisper.cpp revision; use an empty VOICE_TOOLS_DIR' >&2; exit 1
fi
cmake -S "$voice_tools_dir/whisper.cpp" -B "$voice_tools_dir/whisper.cpp/build" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_CURL=OFF
cmake --build "$voice_tools_dir/whisper.cpp/build" -j 4
bash "$voice_tools_dir/whisper.cpp/models/download-ggml-model.sh" base.en "$voice_tools_dir/models"
echo "Local STT ready under $voice_tools_dir. See packages/voice/README.md for server and CLI settings."

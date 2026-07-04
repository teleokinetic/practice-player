#!/bin/zsh
# Build TTS segments for the practice player.
# Usage: ./scripts/build_audio.sh [segments.json]   (run from repo root; needs OPENAI_API_KEY, ffmpeg)
# Voice settings follow the ATM audio convention: nova / 0.80 / tts-1-hd.
set -e
SEGS="${1:-scripts/segments.json}"
cd "$(dirname "$0")/.."
mkdir -p audio/raw

python3 - "$SEGS" <<'PY' > /tmp/seglist.txt
import json, sys
for k, v in json.load(open(sys.argv[1])).items():
    print(k + '\t' + v.replace('\n', ' '))
PY

while IFS=$'\t' read -r id text; do
  if [ -s "audio/raw/${id}.mp3" ]; then echo "skip ${id}"; continue; fi
  echo "tts  ${id}"
  python3 - "$id" "$text" <<'PY'
import json, sys
body = {"model": "tts-1-hd", "voice": "nova", "speed": 0.80,
        "response_format": "mp3", "input": sys.argv[2]}
open('/tmp/tts_body.json', 'w').write(json.dumps(body))
PY
  curl --http1.1 -sS --retry 3 --retry-all-errors \
    -X POST "https://api.openai.com/v1/audio/speech" \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d @/tmp/tts_body.json \
    -o "audio/raw/${id}.mp3"
  # a JSON body back means an API error, not audio
  if head -c1 "audio/raw/${id}.mp3" | grep -q '{'; then
    echo "ERROR on ${id}:"; cat "audio/raw/${id}.mp3"; rm "audio/raw/${id}.mp3"; exit 1
  fi
done < /tmp/seglist.txt

# chime: matches the course page's WebAudio chime (660 Hz then 528 Hz, gentle decay)
ffmpeg -y -loglevel error -f lavfi \
  -i "aevalsrc=0.20*exp(-2.2*t)*sin(2*PI*660*t)+0.20*exp(-2.2*(t-0.6))*sin(2*PI*528*t)*gt(t\,0.6):d=2.4:s=44100" \
  -ac 1 -b:a 96k audio/chime.mp3

# 30s silence block — dwells are built by looping this, so playback (and the
# session) survives a locked phone screen
ffmpeg -y -loglevel error -f lavfi -i "anullsrc=r=44100:cl=mono" -t 30 -b:a 32k audio/silence30.mp3

# loudness-normalize narration to -16 LUFS / -1.5 dBTP (speech on phone speakers)
for f in audio/raw/*.mp3; do
  out="audio/$(basename "$f")"
  ffmpeg -y -loglevel error -i "$f" \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar 44100 -ac 1 -b:a 96k "$out"
done

echo "--- loudness check (first + longest segment) ---"
for f in audio/soak1_verify.mp3 audio/soak3.mp3; do
  echo "$f:"
  ffmpeg -i "$f" -af loudnorm=print_format=summary -f null - 2>&1 | grep -E "Input Integrated|Input True Peak" | head -2
done
echo "done: $(ls audio/*.mp3 | wc -l | tr -d ' ') files in audio/"

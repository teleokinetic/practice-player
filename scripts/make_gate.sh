#!/bin/zsh
# Generate a 4-word passphrase, encrypt $OPENAI_API_KEY with it (PBKDF2 600k + AES-256-GCM),
# and write: passphrase -> $1 (private file), ciphertext constants -> $2 (safe to publish).
# Nothing secret is printed to stdout.
set -e
PASSFILE="$1"; ENCFILE="$2"
[ -n "$PASSFILE" ] && [ -n "$ENCFILE" ] || { echo "usage: make_gate.sh <passfile> <encfile>"; exit 1; }
[ -n "$OPENAI_API_KEY" ] || { echo "OPENAI_API_KEY not set"; exit 1; }

python3 - "$PASSFILE" <<'PY'
import random, re, sys
words=[w.strip() for w in open('/usr/share/dict/words') if re.fullmatch(r'[a-z]{4,7}', w.strip())]
open(sys.argv[1],'w').write('-'.join(random.SystemRandom().choice(words) for _ in range(4))+'\n')
PY

node -e '
const fs=require("fs"), crypto=require("crypto");
const pass=fs.readFileSync(process.argv[1],"utf8").trim();
const key=process.env.OPENAI_API_KEY;
const salt=crypto.randomBytes(16), iv=crypto.randomBytes(12);
const k=crypto.pbkdf2Sync(pass, salt, 600000, 32, "sha256");
const c=crypto.createCipheriv("aes-256-gcm", k, iv);
const ct=Buffer.concat([c.update(key,"utf8"), c.final(), c.getAuthTag()]);
fs.writeFileSync(process.argv[2], JSON.stringify({salt:salt.toString("base64"), iv:iv.toString("base64"), ct:ct.toString("base64")}));
' "$PASSFILE" "$ENCFILE"
echo "wrote passphrase to $PASSFILE and ciphertext constants to $ENCFILE"

import gguf, re

BLOB = r"C:\Users\dnake\.ollama\models\blobs\sha256-5c19f6282f4fc51cb114cb6c876d70ca2fc3b9cf0fbd0a018d9908f4fe1f63b3"
LOG  = r"C:\Users\dnake\AppData\Local\Allpaca\server.log"

r = gguf.GGUFReader(BLOB)
created = set()
for line in open(LOG, encoding="utf-8", errors="ignore"):
    m = re.search(r"create_tensor: loading tensor (\S+)", line)
    if m:
        created.add(m.group(1))

missing = [t for t in r.tensors if t.name not in created]
print(f"file tensors: {len(r.tensors)}  created: {len(created)}  unclaimed: {len(missing)}")
for t in sorted(missing, key=lambda x: x.name):
    print(f"  {t.name}   dims(ne)={t.shape}")

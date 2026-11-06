import sys

p = r"C:\Users\dnake\Documents\BobsWorkshop\allpaca_5085e646\source\llama\llama.cpp\src\llama-arch.cpp"
src = open(p, "r", encoding="utf-8", newline="").read()

nl = "\r\n" if "\r\n" in src else "\n"

# Unique anchor: this comment exists only inside the LLM_ARCH_NEMOTRON_H_MOE case
anchor_lines = [
    "                // MoE shared expert layer",
    "                LLM_TENSOR_FFN_DOWN_SHEXP,",
    "                LLM_TENSOR_FFN_UP_SHEXP,",
    "            };",
]
old = nl.join(anchor_lines)
count = src.count(old)
if count != 1:
    print(f"ABORT: anchor found {count} times (expected exactly 1). File layout differs.")
    sys.exit(1)

insert = [
    "                // Nemotron 3.5 revision: draft/nextn layer weights + post-attn norm",
    "                LLM_TENSOR_ATTN_POST_NORM,",
    "                LLM_TENSOR_NEXTN_EH_PROJ,",
    "                LLM_TENSOR_NEXTN_EMBED_TOKENS,",
    "                LLM_TENSOR_NEXTN_ENORM,",
    "                LLM_TENSOR_NEXTN_HNORM,",
    "                LLM_TENSOR_NEXTN_SHARED_HEAD_HEAD,",
    "                LLM_TENSOR_NEXTN_SHARED_HEAD_NORM,",
]
new = nl.join(anchor_lines[:3] + insert + [anchor_lines[3]])

src = src.replace(old, new)
open(p, "w", encoding="utf-8", newline="").write(src)
print("Patched llama-arch.cpp: NEMOTRON_H_MOE set +7 entries")

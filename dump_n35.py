import gguf, re
from collections import Counter

BLOB = r"C:\Users\dnake\.ollama\models\blobs\sha256-5c19f6282f4fc51cb114cb6c876d70ca2fc3b9cf0fbd0a018d9908f4fe1f63b3"

# exactly the tensor set our vendored engine maps for nemotron_h_moe
# (verified against the cached llama-arch.cpp, LLM_ARCH_NEMOTRON_H_MOE case)
known = {
 'attn_norm','ssm_in','ssm_conv1d','ssm_dt','ssm_a','ssm_d','ssm_norm','ssm_out',
 'attn_q','attn_k','attn_v','attn_output',
 'ffn_down','ffn_up','ffn_gate_inp','ffn_up_exps','ffn_down_exps','ffn_exp_probs_b',
 'ffn_down_shexp','ffn_up_shexp',
}

r = gguf.GGUFReader(BLOB)
print("total tensors in file:", len(r.tensors))

layers = set()
unknown = Counter()
mapped = 0
for t in r.tensors:
    name = t.name
    m = re.match(r'^blk\.(\d+)\.', name)
    if m:
        layers.add(int(m.group(1)))
    if name.startswith(('token_embd','output_norm','output','position_embd')):
        continue
    if not name.startswith('blk.'):
        unknown[name] += 1
        continue
    tail = re.sub(r'^blk\.\d+\.', '', name)
    tail = re.sub(r'\.(weight|bias)$', '', tail)
    if tail in known:
        mapped += 1
    else:
        unknown[tail] += 1

print("block layers:", len(layers))
print("tensors mapped to known names:", mapped)
print()
print("=== names the engine does NOT know ===")
for tail, count in sorted(unknown.items()):
    print(f"{count:5d}   {tail}")

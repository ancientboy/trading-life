#!/bin/bash
# Push pending signals to wechat via openclaw message tool
cd /opt/trading-agent/scripts
QUEUE_FILE="../data/wechat_push_queue.jsonl"

if [ ! -f "$QUEUE_FILE" ]; then
    exit 0
fi

# Read and push unpushed messages
python3 << 'PYEOF'
import json, subprocess, sys

queue_file = "/opt/trading-agent/data/wechat_push_queue.jsonl"
try:
    with open(queue_file, "r") as f:
        lines = f.readlines()
except:
    sys.exit(0)

updated = []
for line in lines:
    try:
        item = json.loads(line.strip())
        if item.get("pushed"):
            updated.append(line)
            continue
        
        msg = item.get("message", "")
        if not msg:
            continue
        
        # Send via openclaw message
        # Write to a temp file and use message tool
        result = subprocess.run(
            ["openclaw", "message", "send", "--channel", "openclaw-weixin",
             "--to", "o9cq801kLBuLl3lPs3gk_40jqkww@im.wechat",
             "--message", msg],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            item["pushed"] = True
            updated.append(json.dumps(item, ensure_ascii=False) + "\n")
        else:
            updated.append(line)
    except:
        updated.append(line)

with open(queue_file, "w") as f:
    f.writelines(updated)
PYEOF

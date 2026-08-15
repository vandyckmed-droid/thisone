#!/usr/bin/env python3
"""
A plain table view of every data file. No design, just the numbers.

History is dropped -- it is ~95% of the bytes and unreadable as a table
anyway -- so the page is small and opens instantly.

Usage:
    python3 scripts/build_browse.py [out.html]     (default: web/browse.html)
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

COLS = [
    ("symbol", "SYMBOL", "t"), ("name", "NAME", "t"),
    ("sector", "SECTOR", "t"), ("industry", "INDUSTRY", "t"),
    ("exchange", "EXCH", "t"),
    ("marketCap", "MKT CAP", "cap"), ("price", "PRICE", "n2"),
    ("changePct", "1D", "pct"),
    ("r1w", "1W", "pct"), ("r1m", "1M", "pct"), ("r3m", "3M", "pct"),
    ("r6m", "6M", "pct"), ("rytd", "YTD", "pct"), ("r1y", "1Y", "pct"),
    ("r2y", "2Y", "pct"),
    ("v30", "VOL30", "n1"), ("v90", "VOL90", "n1"), ("v1y", "VOL1Y", "n1"),
    ("dd", "MAXDD", "n1"), ("firstSession", "LISTED", "t"),
]


def flatten(t: dict) -> dict:
    r, v = t.get("returns") or {}, t.get("volatility") or {}
    return {
        "symbol": t["symbol"], "name": t["name"], "sector": t.get("sector", ""),
        "industry": t.get("industry", ""), "exchange": t.get("exchange", ""),
        "marketCap": t.get("marketCap"), "price": t.get("price"),
        "changePct": t.get("changePct"),
        "r1w": r.get("1w"), "r1m": r.get("1m"), "r3m": r.get("3m"),
        "r6m": r.get("6m"), "rytd": r.get("ytd"), "r1y": r.get("1y"), "r2y": r.get("2y"),
        "v30": v.get("30d"), "v90": v.get("90d"), "v1y": v.get("1y"),
        "dd": t.get("maxDrawdown1y"), "firstSession": t.get("firstSession", ""),
    }


PAGE = """<title>Data browser</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
body{margin:0;background:#111;color:#ddd;font:13px/1.4 ui-monospace,Menlo,monospace}
#bar{position:sticky;top:0;background:#181818;border-bottom:1px solid #333;padding:8px;
     display:flex;gap:8px;flex-wrap:wrap;align-items:center;z-index:2}
select,input{background:#222;color:#ddd;border:1px solid #444;padding:6px 8px;font:inherit}
input{flex:1;min-width:140px}
#meta{color:#888;font-size:12px}
#wrap{overflow:auto}
table{border-collapse:collapse;white-space:nowrap}
th{position:sticky;top:0;background:#1e1e1e;border-bottom:1px solid #444;padding:6px 9px;
   text-align:right;cursor:pointer;font-weight:normal;color:#aaa}
th:hover{color:#fff}
th.t,td.t{text-align:left}
td{padding:5px 9px;border-bottom:1px solid #222;font-variant-numeric:tabular-nums}
tr:nth-child(even) td{background:#161616}
.p{color:#5c5}.n{color:#e66}
td.t:nth-child(2){max-width:230px;overflow:hidden;text-overflow:ellipsis}
</style>
<div id="bar">
  <select id="u"></select>
  <input id="q" placeholder="filter" autocomplete="off">
  <span id="meta"></span>
</div>
<div id="wrap"><table><thead><tr id="hd"></tr></thead><tbody id="tb"></tbody></table></div>
<script>
const D=__DATA__,C=__COLS__;
let key='marketCap',dir=-1,uni=Object.keys(D.tables)[0];
const cap=v=>v==null?'':v>=1e12?(v/1e12).toFixed(2)+'T':v>=1e9?(v/1e9).toFixed(1)+'B':(v/1e6).toFixed(0)+'M';
const fmt={t:v=>v==null?'':v,cap,n1:v=>v==null?'':v.toFixed(1),n2:v=>v==null?'':v.toFixed(2),
  pct:v=>v==null?'':(v>=0?'+':'')+v.toFixed(1)+'%'};
document.getElementById('u').innerHTML=D.universes.map(u=>
  `<option value="${u.key}">${u.title} (${u.size})</option>`).join('');
document.getElementById('hd').innerHTML=C.map(c=>
  `<th class="${c[2]==='t'?'t':''}" data-k="${c[0]}">${c[1]}</th>`).join('');
function draw(){
  const q=document.getElementById('q').value.trim().toLowerCase();
  let rows=D.tables[uni];
  if(q)rows=rows.filter(r=>(r.symbol+' '+r.name+' '+r.sector+' '+r.industry).toLowerCase().includes(q));
  rows=[...rows].sort((a,b)=>{const x=a[key],y=b[key];
    if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;
    return typeof x==='string'?dir*x.localeCompare(y):dir*(x-y);});
  document.getElementById('meta').textContent=`${rows.length} rows | ${D.dataDate}`;
  document.getElementById('tb').innerHTML=rows.map(r=>'<tr>'+C.map(c=>{
    const v=r[c[0]],s=fmt[c[2]](v);
    const col=(c[2]==='pct'&&v!=null)?(v>=0?' p':' n'):'';
    return `<td class="${c[2]==='t'?'t':''}${col}">${s===''?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</td>`;
  }).join('')+'</tr>').join('');
}
document.getElementById('hd').onclick=e=>{const th=e.target.closest('th');if(!th)return;
  const k=th.dataset.k;dir=(k===key)?-dir:(C.find(c=>c[0]===k)[2]==='t'?1:-1);key=k;draw();};
document.getElementById('u').onchange=e=>{uni=e.target.value;draw()};
document.getElementById('q').oninput=draw;
draw();
</script>"""


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "web" / "browse.html"
    index = json.loads((DATA / "index.json").read_text())

    tables, universes = {}, []
    for u in index["universes"]:
        table = json.loads((DATA / u["file"]).read_text())
        tables[u["key"]] = [flatten(t) for t in table["tickers"]]
        universes.append({"key": u["key"], "title": table.get("title", u["key"]),
                          "size": len(tables[u["key"]])})

    payload = {"dataDate": index["dataDate"], "universes": universes, "tables": tables}
    html = (PAGE
            .replace("__DATA__", json.dumps(payload, separators=(",", ":")).replace("</", "<\\/"))
            .replace("__COLS__", json.dumps(COLS, separators=(",", ":"))))
    out.write_text(html)
    rows = sum(len(v) for v in tables.values())
    print(f"Wrote {out} ({out.stat().st_size / 1024:.0f}KB, {len(tables)} tables, {rows} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

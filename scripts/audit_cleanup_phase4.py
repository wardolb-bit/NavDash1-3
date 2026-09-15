from pathlib import Path
import re

page = Path('app/wx-routing/page.tsx')
text = page.read_text(encoding='utf-8')

# Extract stable type contracts.
type_start = text.index('type GribTimelineRow = {')
type_end = text.index('const MAPLIBRE_CSS_ID =')
type_block = text[type_start:type_end]
exported_types = re.sub(r'(?m)^type ', 'export type ', type_block).rstrip() + '\n'
Path('app/wx-routing/wxRoutingTypes.ts').write_text(exported_types, encoding='utf-8')

type_names = re.findall(r'(?m)^type\s+(\w+)\s*=', type_block)
type_import = 'import type { ' + ', '.join(type_names) + ' } from "./wxRoutingTypes";\n'
text = text[:type_start] + type_import + text[type_end:]

# Extract map/layer identifiers into a single map config module.
const_pattern = re.compile(
    r'const MAPLIBRE_CSS_ID = .*?\nconst AIS_ORIGIN_MAX_OFF_TRACK_NM = 25;\n',
    re.S,
)
match = const_pattern.search(text)
if not match:
    raise SystemExit('Could not locate WX map constants block')
const_block = match.group(0)
const_names = re.findall(r'(?m)^const\s+(\w+)\s*=', const_block)
exported_consts = re.sub(r'(?m)^const ', 'export const ', const_block).rstrip() + '\n'
Path('app/wx-routing/wxRoutingMapConfig.ts').write_text(exported_consts, encoding='utf-8')
const_import = 'import { ' + ', '.join(const_names) + ' } from "./wxRoutingMapConfig";\n'
text = text[:match.start()] + const_import + text[match.end():]

# Extract pure display-formatting utilities.
helper_names = ['formatNumber', 'propertyNumber', 'formatDirection', 'formatFileSize', 'formatLatLon']
helper_blocks = []
for name in helper_names:
    pattern = re.compile(r'function\s+' + name + r'\([^\n]*?\)\s*\{.*?\n\}\n', re.S)
    m = pattern.search(text)
    if not m:
        raise SystemExit(f'Could not locate helper {name}')
    helper_blocks.append('export ' + m.group(0).strip() + '\n')
    text = text[:m.start()] + text[m.end():]
Path('app/wx-routing/wxRoutingFormat.ts').write_text('\n'.join(helper_blocks), encoding='utf-8')
format_import = 'import { ' + ', '.join(helper_names) + ' } from "./wxRoutingFormat";\n'
insert_at = text.index('import type {')
text = text[:insert_at] + format_import + text[insert_at:]

# Replace the header JSX with a dedicated component.
header_pattern = re.compile(r'        <header className=\{`flex flex-col gap-3 border p-3.*?        </header>\n', re.S)
header_match = header_pattern.search(text)
if not header_match:
    raise SystemExit('Could not locate WX header JSX')
header_replacement = '''        <WxRoutingHeader
          dayMode={dayMode}
          nightMode={nightMode}
          activePanel={activePanel}
          onPanelChange={setActivePanel}
          onToggleTheme={toggleTheme}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          buttonClass={buttonClass}
          activeButtonClass={activeButtonClass}
          labelClass={labelClass}
          mutedClass={mutedClass}
        />\n'''
text = text[:header_match.start()] + header_replacement + text[header_match.end():]
first_import_end = text.find('\n', text.index('import ')) + 1
text = text[:first_import_end] + 'import WxRoutingHeader from "./WxRoutingHeader";\n' + text[first_import_end:]
page.write_text(text, encoding='utf-8')

header = '''"use client";

import type { Dispatch, SetStateAction } from "react";
import type { WxRoutingPanel } from "./wxRoutingTypes";

type Props = {
  dayMode: boolean;
  nightMode: boolean;
  activePanel: WxRoutingPanel;
  onPanelChange: Dispatch<SetStateAction<WxRoutingPanel>>;
  onToggleTheme: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  buttonClass: string;
  activeButtonClass: string;
  labelClass: string;
  mutedClass: string;
};

const PANELS: WxRoutingPanel[] = ["GRIB", "ROUTE", "STORM", "WHAT IF", "COMPARE", "LAYERS"];

export default function WxRoutingHeader({
  dayMode,
  nightMode,
  activePanel,
  onPanelChange,
  onToggleTheme,
  isFullscreen,
  onToggleFullscreen,
  buttonClass,
  activeButtonClass,
  labelClass,
  mutedClass,
}: Props) {
  return (
    <header className={`flex flex-col gap-3 border p-3 lg:flex-row lg:items-center lg:justify-between ${dayMode ? "border-slate-300 bg-white text-slate-900" : "border-white/10 bg-[#071019] text-[#dbe5ee]"}`}>
      <div>
        <div className={labelClass}>NavDash 1.3 Weather</div>
        <h1 className="text-3xl font-black uppercase tracking-wide">WX Routing</h1>
        <p className={`mt-1 text-sm ${mutedClass}`}>
          Planning Aid - Verify against official forecasts, approved charts, vessel limitations, and Master/bridge-team judgment.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PANELS.map((item) => (
          <button
            key={item}
            type="button"
            className={activePanel === item ? activeButtonClass : buttonClass}
            onClick={() => onPanelChange(item)}
          >
            {item}
          </button>
        ))}
        <button type="button" className={buttonClass} onClick={onToggleTheme}>
          {nightMode ? "Day Mode" : "Night Mode"}
        </button>
        <button type="button" className={buttonClass} onClick={onToggleFullscreen}>
          {isFullscreen ? "Exit Full Screen" : "Full Screen"}
        </button>
      </div>
    </header>
  );
}
'''
Path('app/wx-routing/WxRoutingHeader.tsx').write_text(header, encoding='utf-8')

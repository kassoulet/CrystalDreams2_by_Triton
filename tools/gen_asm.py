"""Build the 'asm' cards of index.html straight from tools/img.bin (never typed by hand)."""
import subprocess, os, html, re
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, 'img.bin')

def dis(start, end):
    out = subprocess.run(['ndisasm', '-b16', '-o', str(start), '-e', str(start), IMG],
                         capture_output=True, text=True).stdout
    rows = []
    for ln in out.split('\n'):
        m = re.match(r'([0-9A-F]{8})\s+([0-9A-F]+)\s+(.*)', ln)
        if not m: continue
        a = int(m.group(1), 16)
        if a >= end: break
        b = m.group(2)
        t = m.group(3).lower()
        if b[:2] in ('D1', ) and t.endswith(',0x0'): t = t[:-4] + ',1'   # ndisasm prints shift-by-1 as ,0x0
        if b[:4] == '66D1' and t.endswith(',0x0'): t = t[:-4] + ',1'
        rows.append((a, ' '.join(b[i:i+2] for i in range(0, len(b), 2)), t))
    return rows

def listing(ranges, notes):
    lines = []
    for r in ranges:
        if r == '...': lines.append('...'); continue
        for a, b, t in dis(*r):
            c = notes.get(a)
            lines.append(f'{a:05X}  {b:<17} {t}' + (f'   ; {c}' if c else ''))
    return html.escape('\n'.join(lines))

CARDS = [
 dict(n='01', fav=True, kind='hand', title='Write columns, not rows', sub='Mode X planar blit · image offset 0x6E1',
  ranges=[(0x6E1, 0x711)],
  notes={0x6ED:'plane mask for x mod 4, from a 4-byte table in CS', 0x6F7:'one OUT selects the plane (index 2 + mask in AH)',
         0x702:'one pixel; SI/DI auto-increment', 0x703:'+319 (+1 from movsb) = next source row of a 320-wide image',
         0x707:'-81 (+1 from movsb) = +80, next Mode X row', 0x70A:'200 rows per column'},
  text='Mode X splits a row across four planes, so a plain left-to-right copy would need a plane switch every pixel. This loop turns the copy sideways: for each of the 320 columns it does <em>one</em> <code>OUT DX,AX</code> to pick the plane, then walks 200 rows with <code>movsb</code>. That is 320 port writes instead of 64,000. The two odd-looking constants are strides with the <code>movsb</code> auto-increment folded in: <code>+0x13F</code> (319) plus the 1 from <code>movsb</code> is a 320-byte source row, and <code>−0x51</code> (81) plus 1 is the 80-byte Mode X row. The routine appears twice back to back; the second copy writes through ES = 0x30, a flat selector.',
  foot=('VGA · 0x3C4','320 OUTs, 64,000 movsb')),
 dict(n='02', fav=True, kind='hand', title='Fill a span four bytes at a time', sub='Polygon scanline fill · image offset 0x22EAF / 0x22EE0',
  ranges=[(0x22EAF, 0x22EC1), '...', (0x22EE0, 0x22F18)],
  notes={0x22EB7:'AL → AX → EAX: the colour byte copied into all four bytes', 0x22EE5:'CX = x2 − x1', 0x22EEB:'swap so the span always runs left to right',
         0x22EF1:'byte alignment prologue', 0x22F00:'word alignment prologue', 0x22EFB:'SHR CX,1: the odd-byte bit goes to CF…',
         0x22EFF:'…and PUSHF parks it across the loop', 0x22F10:'the actual work: 4 pixels per store', 0x22F13:'POPF restores CF', 0x22F14:'…so a trailing byte is one JNC away'},
  text='The scanline filler first replicates the colour into <code>EAX</code> (<code>mov ah,al</code> … <code>shl eax,16</code> … <code>mov ax,dx</code>). Then it aligns the destination with at most one <code>stosb</code> and one <code>stosw</code>, so the bulk can be a single <code>rep stosd</code>. The neat part is bookkeeping: <code>shr cx,1</code> leaves the odd-pixel flag in the carry, and <code>pushf</code>/<code>popf</code> carries it across the fill instead of burning a register. The <code>0x1234</code> immediates in the edge-stepping lines just above look like placeholders; I did not find the code that patches them, so I will not claim self-modifying code.',
  foot=('386 · rep stosd','align, bulk, tail')),
 dict(n='03', fav=True, kind='hand', title='Square root by Newton, 64 bits in', sub='Integer sqrt · image offset 0x16120',
  ranges=[(0x16120, 0x16179)],
  notes={0x16124:'ECX = low dword of N', 0x16128:'ESI = high dword of N', 0x16134:'first guess: N/2 + 1',
         0x1613E:'N ≥ 2^32: start from the largest positive dword', 0x16144:'17 fixed iterations',
         0x1614D:'EDX:EAX / EBX: a 64-bit dividend',
         0x16153:'x + N/x as a 33-bit value: ADD then ADC into EBP', 0x1615A:'SHRD by 1 = (x + N/x) / 2 with the carry bit shifted back in',
         0x1616D:'returned as DX:AX (the Pascal longint convention)'},
  text='A fixed-iteration Newton–Raphson square root, <code>x ← (x + N/x) / 2</code>. The detail worth stealing is the averaging step: <code>x + N/x</code> can exceed 32 bits, so the code adds with <code>add</code>/<code>adc</code> into a second register and then halves the 33-bit sum with one <code>shrd eax,ebp,1</code>. No overflow guard, no branch. Seventeen iterations is a blunt but constant-time answer for 64-bit input.',
  foot=('386 · div, adc, shrd','17 iterations, branch-free')),
 dict(n='04', fav=True, kind='hand', title='Normalise a vector without losing a bit', sub='|v|² in 96 bits, then scale · image offset 0x16179',
  ranges=[(0x16179, 0x161A6), '...', (0x161B8, 0x161CE)],
  notes={0x16183:'one-operand IMUL: EDX:EAX = x²', 0x16186:'keep the high half in EDI', 0x16189:'low half in ECX',
         0x16193:'add y² …', 0x16196:'… carry into the high half', 0x161A0:'add z²', 0x161A3:'EDX:EAX = x²+y²+z² (64-bit)',
         0x161B2:'call the Newton sqrt above', 0x161C5:'component × target length', 0x161C8:'÷ actual length, rounded toward zero'},
  text='Vectors are three signed dwords. The squared length is accumulated with the one-operand <code>imul</code>, which yields a full 64-bit product in <code>EDX:EAX</code>, and three <code>add</code>/<code>adc</code> pairs that propagate carries. The result feeds the square root above, and each component is then rescaled with <code>imul ecx</code> / <code>idiv ebx</code>, a 64-bit intermediate again, so precision is never thrown away before the divide.',
  foot=('386 · imul, adc, idiv','no precision lost')),
 dict(n='05', kind='hand', title='16.16 squares with SHRD', sub='Fixed-point sum of squares · image offset 0x18327',
  ranges=[(0x18327, 0x18363)],
  notes={0x18330:'EDX:EAX = x²  (value in 16.16, so the product is 32.32)', 0x18333:'SHRD by 16 takes the middle dword: back to 16.16',
         0x18338:'running total in ECX', 0x1835E:'sign taken from ESI (the third value): negate the total if it is negative'},
  text='When values are 16.16 fixed point, multiplying gives 32.32. This code squares three table entries and slides each product back with <code>shrd eax,edx,16</code>, a single instruction doing the 64→32 rescale a 16-bit compiler would need a loop of shifts for.',
  foot=('386 · imul, shrd','3 squares, 3 shifts')),
 dict(n='06', kind='hand', title='Clip the edge, not the loop', sub='Slope × clip distance · image offset 0x3B2E',
  ranges=[(0x3B2E, 0x3B52)],
  notes={0x3B30:'IMUL: signed 16×16 → high part', 0x3B33:'MUL: unsigned low part', 0x3B35:'recombine into a 32-bit product',
         0x3B37:'add into the 32-bit edge accumulator held in memory', 0x3B3B:'ADC propagates the carry'},
  text='Before filling a polygon the rasteriser advances each edge to the clip window in one step: two 32-bit fixed-point slopes (the routine updates two accumulators) times the number of clipped scanlines, using one <code>imul</code> for the signed high word and one <code>mul</code> for the low word, then <code>add</code>/<code>adc</code> straight into the edge variables. A multiply per clipped edge replaces stepping through invisible scanlines.',
  foot=('16-bit · imul + mul','32×16 multiply by hand')),
 dict(n='07', kind='hand', title='Crop with rep movsd', sub='256-wide crop of a 320×200 image · image offset 0x195B8',
  ranges=[(0x195B8, 0x195D8)],
  notes={0x195CB:'0x40 dwords = 256 bytes per row', 0x195CE:'4 bytes per iteration', 0x195D1:'skip the remaining 64 of the 320 source bytes'},
  text='Texture-sized 256×200 data is cut out of a 320×200 screen buffer with 200 short <code>rep movsd</code> runs and a 64-byte skip per row. No per-pixel work, and the destination stays contiguous so later lookups can use an 8-bit column index.',
  foot=('386 · rep movsd','200 rows × 64 dwords')),
 dict(n='08', kind='rtl', title='Borland’s CPU test and long multiply', sub='Pascal runtime, not Triton · image offset 0x31571 / 0x31E4C',
  ranges=[(0x31571, 0x31596), '...', (0x31E4C, 0x31E6E)],
  notes={0x31575:'clear FLAGS bits 12–15', 0x31582:'still set → 8086', 0x31591:'settable → 386 or later', 0x31592:'level 0/1/2 stored at DS:6FFA',
         0x31E4C:'every long helper starts with this test', 0x31E57:'DX:AX → EAX', 0x31E65:'one IMUL', 0x31E68:'low 32 bits back in DX:AX'},
  text='This is the most quoted snippet in the file and it is <strong>not</strong> demo-author code. It sits beside the string <code>Copyright (c) 1983,92 Borland</code>: it is the Borland Pascal 7 runtime, which tests the CPU once at start-up and then lets its long multiply/divide/shift helpers (four of them, at 0x31E4C, 0x31E89, 0x31F2F, 0x31F48) use 32-bit instructions on a 386. Two corrections to what an earlier version of this page said: the multiply returns only the <em>low 32 bits</em> (not a 64-bit product), and the demo does <em>not</em> run on a 286: it refuses to start below a 386 (see the message in the runtime section).',
  foot=('x86 · FLAGS probe','compiler runtime')),
 dict(n='09', kind='compiled', title='Flip on the beam', sub='CRTC start address · image offset 0x30545',
  ranges=[(0x30545, 0x3056C)],
  notes={0x30553:'bit 3 of 0x3DA: vertical retrace', 0x30555:'loop while retrace is active', 0x30560:'CRTC register 0x0C: start address high',
         0x30565:'one OUT writes index and data', 0x30568:'then register 0x0D: start address low'},
  text='Textbook Mode X double buffering: draw into the hidden page, then move the CRTC start address. It is compiler-shaped (<code>push bp</code>/<code>mov bp,sp</code> frame, argument at <code>[bp+6]</code>), so I credit the technique, not hand-tuning. Note that <code>out dx,ax</code> writes the CRTC index and its data with one instruction.',
  foot=('VGA · CRTC 0x0C/0x0D','compiled Pascal')),

 dict(n='10', fav=True, kind='hand', title='Scale a column with an end-around carry', sub='Fractal zoom column scaler · image offset 0x7FB1 (block at 0x81ED)',
  ranges=[(0x81ED, 0x8240)],
  notes={0x81F0:'tile segment chosen by bit 9 of the column index', 0x81F8:'per-column record from the code segment: count,',
         0x8201:'destination offset,', 0x8205:'and a 32-bit fixed-point source position', 0x820A:'+ column*128 = start of the source column',
         0x820F:'low two bits of the count pick the entry point in the 4x unrolled body (Duff style)',
         0x822D:'copy one byte (SI and DI advance)', 0x822E:'ESI += ECX + carry: the carry out of the fraction re-enters as +1 on the position',
         0x823D:'4 pixels per trip'},
  text='This is the engine of the fractal zoom. The picture is a log-mapped strip, so zooming is just scrolling it: <code>col = T[z&amp;7][j] − (z&gt;&gt;3)</code>. Each screen column is then a vertical slice of that strip scaled by a per-column factor. The scaler keeps source position and fraction in one <code>ESI</code>: <code>movsb</code> advances the 16-bit position by one, and <code>adc esi,ecx</code> adds the step to both halves, with the carry out of the fractional half re-entering as +1 on the position. That is Bresenham with no branch, unrolled four times and entered through the low two bits of the count. I ran this exact routine under emulation to read the zoom back out of <code>MegaFrac.DAT</code> (see the Recreation).',
  foot=('386 · movsb, adc esi','100 columns x 400 pixels per frame')),

 dict(n='11', fav=True, kind='hand', title='Patch the loop, not the index', sub='Plasma renderer · image offset 0x3A82 (loop at 0x3B09)',
  ranges=[(0x3A86, 0x3A9F), '...', (0x3B06, 0x3B6A)],
  notes={0x3A8E:'PATCH: the step (7) becomes the displacement inside the loop below',
         0x3A98:'PATCH: 2 x step', 0x3AA2:'PATCH: 3 x step ... up to 8 x step (the loop advance)',
         0x3B02:'DS = the sine table (a 1 KB sine repeated 63 times so indexes never wrap)',
         0x3B09:'row constant: T[p3] + T[p4]',
         0x3B14:'pixel k: T[si + k*step] + row constant (displacements patched above)',
         0x3B20:'two bytes in AX, ROL 16, two more: four pixels in EAX',
         0x3B2E:'one store for the line below ...', 0x3B34:'... one for this line (pitch 160 bytes)',
         0x3B5A:'si += 8 x step (patched)', 0x3B5E:'wrap at 0x7FFF'},
  text='The plasma is <code>T[p1+2y+7x] + T[p3−3y] + T[p4−y]</code> with <code>T = 128+127·sin</code>, written in 4-pixel blocks (all four planes enabled, so a byte is four identical pixels) and in two identical lines per store. The cheap part is the inner loop: the eight table offsets are <em>immediates inside the instructions</em> (<code>[si+0x201]</code> is a placeholder). At the top of each frame the routine writes the step multiples straight into its own code through a code-segment alias, so the loop needs no index registers for them. I ran this routine, the table builder and the palette routine under emulation; the JavaScript scene matches them exactly (see the Recreation).',
  foot=('386 · self-modifying code','80 x 100 blocks per frame')),
]
KIND = {'hand': 'asm-style (32-bit regs in 16-bit code, no Pascal frame)', 'rtl': 'Borland Pascal runtime', 'compiled': 'compiler output'}

def render():
    out = []
    for c in CARDS:
        badge = ('<span class="badge">★ favourite</span>' if c.get('fav') else '') + f'<span class="badge">{KIND[c["kind"]].split(" (")[0]}</span>'
        out.append(f'''      <article class="asm-card">
        <div class="asm-top"><span class="asm-num">{c['n']}</span>{badge}</div>
        <h3>{c['title']}</h3>
        <p class="asm-sub">{c['sub']}</p>
        <pre class="asm-mini"><code class="asm">{listing(c['ranges'], c['notes'])}</code></pre>
        <p>{c['text']}</p>
        <div class="asm-foot"><span>{c['foot'][0]}</span><span>{c['foot'][1]}</span></div>
      </article>
''')
    return '\n'.join(out)

if __name__ == '__main__':
    print(render())

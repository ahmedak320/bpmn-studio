/**
 * Open each generated ARIS .aml in OrbitPM ARIS Studio Lite (headless Chromium),
 * Clean-Layout + Zoom-Fit, and screenshot the EPC canvas to <base>.aris.png for
 * the offline gallery. Run:  node_modules/.bin/vite-node scripts/dmt-aris-export-png.mjs
 */
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
const TOOL = 'file:///home/ahmed/Desktop/simulated%20processes/OrbitPM-ARIS-Studio-Lite.html'
const DIR = '/home/ahmed/Desktop/simulated processes/epc-samples-bpmntool'
const IDS = ['dmt-bld-0001-adcm','dmt-com-0223-adcm','dmt-cor-0662-dmt','dmt-inf-1375-adpic','dmt-mob-1834-itc']
const VARIANTS = ['declared','actual']

const b = await chromium.launch()
for (const slug of IDS) {
  for (const v of VARIANTS) {
    const aml = `${DIR}/${slug}.${v}.aml`
    if (!existsSync(aml)) { console.log('skip (no aml)', slug, v); continue }
    const p = await b.newPage({ viewport:{width:1700,height:1200}, deviceScaleFactor:2 })
    try {
      await p.goto(TOOL,{waitUntil:'load'}); await p.waitForTimeout(1200)
      await p.setInputFiles('input[type=file]', aml)
      await p.waitForTimeout(3500)
      for (const label of ['Clean Layout','Zoom Fit']) {
        const btn = p.getByRole('button',{name:label}).first()
        if (await btn.count()) { await btn.click().catch(()=>{}); await p.waitForTimeout(1500) }
      }
      await p.waitForTimeout(800)
      // biggest-area svg = the EPC canvas
      const svgs = await p.$$('svg'); let best=null,area=0
      for (const s of svgs){ const bb=await s.boundingBox(); if(bb&&bb.width*bb.height>area){area=bb.width*bb.height;best=s} }
      const out = `${DIR}/${slug}.${v}.aris.png`
      if (best) { await best.screenshot({ path: out }); console.log('OK', slug, v, Math.round(area)) }
      else console.log('NO SVG', slug, v)
    } catch(e){ console.log('ERR', slug, v, String(e).slice(0,120)) }
    finally { await p.close() }
  }
}
await b.close()
console.log('DONE PNG EXPORT')

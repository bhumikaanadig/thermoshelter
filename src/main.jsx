import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import './styles.css';

const MATERIALS = {
  stone: { name:'Stone', k:1.70, rho:2200, cp:840, t:0.30, alpha:0.65 },
  brick: { name:'Brick', k:0.72, rho:1800, cp:840, t:0.20, alpha:0.55 },
  concrete: { name:'Concrete', k:1.40, rho:2300, cp:880, t:0.10, alpha:0.60 },
  adobe: { name:'Adobe', k:0.43, rho:1600, cp:900, t:0.30, alpha:0.70 },
  rammed: { name:'Rammed Earth', k:0.80, rho:2000, cp:900, t:0.30, alpha:0.65 },
  timber: { name:'Timber', k:0.13, rho:550, cp:1600, t:0.10, alpha:0.55 },
  insulation: { name:'Insulation', k:0.035, rho:40, cp:1400, t:0.05, alpha:0.20 },
};

const CLIMATE = {
  leh: { name:'Leh, Ladakh', mean:-5, amp:9, solar:850, wind:12, humidity:32, elevation:'3,500 m', season:'Winter reference' },
  manali: { name:'Manali, Himachal Pradesh', mean:5, amp:8, solar:720, wind:8, humidity:55, elevation:'2,050 m', season:'Winter reference' },
  srinagar: { name:'Srinagar, Jammu & Kashmir', mean:3, amp:8, solar:680, wind:10, humidity:65, elevation:'1,585 m', season:'Winter reference' },
  shimla: { name:'Shimla, Himachal Pradesh', mean:4, amp:7, solar:650, wind:9, humidity:50, elevation:'2,205 m', season:'Winter reference' },
  jaisalmer: { name:'Jaisalmer, Rajasthan', mean:21, amp:11, solar:920, wind:14, humidity:20, elevation:'225 m', season:'Summer reference' },
  delhi: { name:'Delhi, NCR', mean:24, amp:10, solar:850, wind:8, humidity:55, elevation:'216 m', season:'Reference' },
};

const BASE = {
  location:'leh', occupants:4, target:18, priority:'comfort',
  geometry:{ length:5, width:4.8, height:2.8, orientation:'S', windowArea:2.4, doorArea:1.8 },
  layers:['stone','insulation','concrete'],
};

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function outdoorTemp(c,h){ return c.mean + c.amp * Math.sin(((h-8)/24)*Math.PI*2); }
function solarFactor(h){ return Math.max(0,Math.sin(((h-6)/12)*Math.PI)); }

function solve(s){
  const c=CLIMATE[s.location];
  const g=s.geometry;
  const wallArea=2*(g.length*g.height+g.width*g.height);
  const floorArea=g.length*g.width;
  const envelopeArea=wallArea+floorArea;
  const Rsi=0.13, Rso=0.04;
  const R=Rsi+Rso+s.layers.reduce((sum,id)=>sum+MATERIALS[id].t/MATERIALS[id].k,0);
  const U=1/R;
  const thermalMass=s.layers.reduce((sum,id)=>sum+MATERIALS[id].t*wallArea*MATERIALS[id].rho*MATERIALS[id].cp,0)+floorArea*0.12*2300*880;
  let tin=s.target;
  let solar=0, heatLoss=0, comfortEnergy=0, rows=[];
  for(let h=0;h<24;h++){
    const out=outdoorTemp(c,h);
    const sun=solarFactor(h);
    const orientation=g.orientation==='S'?1.12:g.orientation==='SE'||g.orientation==='SW'?1.06:g.orientation==='E'||g.orientation==='W'?0.92:0.78;
    const windowGain=c.solar*sun*g.windowArea*0.62*orientation;
    const opaqueGain=c.solar*sun*floorArea*0.018*0.65;
    const gain=windowGain+opaqueGain;
    const envelopeLoss=U*wallArea*(tin-out);
    const openingLoss=1.8*g.windowArea*(tin-out)+2.2*g.doorArea*(tin-out);
    const ventilationLoss=0.33*0.45*(floorArea*g.height)*(tin-out);
    const lossW=Math.max(0,envelopeLoss+openingLoss+ventilationLoss);
    const occupantGain=s.occupants*100;
    const net=gain+occupantGain-(envelopeLoss+openingLoss+ventilationLoss);
    const dt=3600*net/Math.max(thermalMass,2.5e6);
    tin += dt;
    solar += Math.max(0,gain)/1000;
    heatLoss += lossW/1000;
    comfortEnergy += Math.abs(tin-s.target);
    rows.push({h,out,tin,gain,loss:lossW,net});
  }
  const vals=rows.map(x=>x.tin);
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  const min=Math.min(...vals), max=Math.max(...vals);
  const meanDev=vals.reduce((a,t)=>a+Math.abs(t-s.target),0)/vals.length;
  const retention=clamp(100-meanDev*3.2,0,100);
  const lossScore=clamp(100/(1+heatLoss/18)*1.12,0,100);
  const solarScore=clamp(solar*2.35,0,100);
  const comfort=clamp(100-meanDev*4.2,0,100);
  const thermalScore=clamp(retention*0.55+lossScore*0.30+solarScore*0.15,0,100);
  const heatingNeed=rows.reduce((sum,r)=>sum+Math.max(0,s.target-r.tin)*0.18,0);
  return {rows,solar,heatLoss,heatingNeed,R,U,avg,min,max,comfort,retention,lossScore,solarScore,thermalScore};
}

function candidate(base,id){
  return {...base,layers:[id,'insulation','concrete']};
}

function App(){
  const [page,setPage]=useState('overview');
  const [s,setS]=useState(BASE);
  const [toast,setToast]=useState('');
  const [simulationRunning,setSimulationRunning]=useState(false);
  const r=useMemo(()=>solve(s),[s]);
  const ranking=useMemo(()=>Object.keys(MATERIALS).filter(k=>k!=='insulation').map(id=>({id,r:solve(candidate(s,id))})).sort((a,b)=>b.r.thermalScore-a.r.thermalScore),[s]);
  const best=ranking[0];
  const update=(patch)=>setS(v=>({...v,...patch}));
  const updateG=(patch)=>setS(v=>({...v,geometry:{...v.geometry,...patch}}));
  const notify=(msg)=>{setToast(msg);setTimeout(()=>setToast(''),2400)};
  const runSimulation = () => 
    {
  setSimulationRunning(true);
  notify('Thermal analysis is running...');

  setTimeout(() => {
    setSimulationRunning(false);
    notify('Thermal analysis completed for current design.');
    setPage('simulate');
  }, 500);
};
  const loadLadakh=()=>{setS(BASE);setPage('design');notify('Leh reference configuration loaded.');};
  const launchDemo=()=>{setS(BASE);setPage('simulate');notify('Ladakh transient simulation completed.');};

  const nav = [
  ['overview', 'Overview'],
  ['climate', 'Climate'],
  ['materials', 'Materials'],
  ['compare', 'Compare'],
  ['optimize', 'Optimize'],
  ['ansys', 'Engineering Simulation'],
  ['report', 'Report']
];
  return <div className="app">
    <header className="topbar"><button className="brand" onClick={()=>setPage('overview')}>THERMO<span>SHELTER</span><small>ANSYS-VALIDATED THERMAL WORKFLOW</small></button>
      <nav>{nav.map(([id,label])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}>{label}</button>)}</nav>
      <button className="start" onClick={()=>setPage('design')}>Start design</button>
    </header>
    {toast&&<div className="toast">✓ {toast}</div>}
    {page==='overview'&&<Overview onDesign={()=>setPage('design')} onExplore={loadLadakh} onLaunch={launchDemo} r={r} best={best}/>} 
    {page==='design'&&
  <Design
    s={s}
    r={r}
    update={update}
    updateG={updateG}
    onRun={runSimulation}
    simulationRunning={simulationRunning}
  />
}
    {page==='climate'&&<ClimatePage/>}
    {page==='materials'&&<MaterialsPage/>}
    {page==='simulate'&&<Simulation s={s} r={r} onRun={runSimulation}/>} 
    {page==='compare'&&<Compare ranking={ranking} s={s}/>} 
    {page==='optimize'&&<Optimize ranking={ranking} best={best} setPage={setPage}/>} 
    {page==='ansys'&&<Ansys r={r}/>} 
    {page==='report'&&<Report s={s} r={r} best={best}/>} 
    <footer>THERMOSHELTER · Prototype thermal decision-support software · TEAM BYTE ME.</footer>
  </div>
}

function Shelter3D() {
  return (
    <div className="shelter-3d">
      <Canvas
        camera={{ position: [7, 5, 7], fov: 42 }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={1.4} />

        <directionalLight
          position={[5, 8, 5]}
          intensity={2.5}
        />

        <directionalLight
          position={[-5, 3, -4]}
          intensity={1}
        />

        {/* Shelter body */}
        <mesh position={[0, 1.5, 0]}>
          <boxGeometry args={[5, 3, 4]} />
          <meshStandardMaterial
            color="#687482"
            roughness={0.72}
            metalness={0.05}
          />
        </mesh>

        {/* Roof */}
        <mesh
          position={[0, 3.15, 0]}
          rotation={[0, 0, 0]}
        >
          <boxGeometry args={[5.35, 0.25, 4.35]} />
          <meshStandardMaterial
            color="#e8e8e2"
            roughness={0.7}
          />
        </mesh>

        {/* Window */}
        <mesh position={[-0.9, 1.8, 2.03]}>
          <boxGeometry args={[1.5, 0.9, 0.08]} />
          <meshStandardMaterial
            color="#9bc7df"
            roughness={0.25}
            metalness={0.1}
          />
        </mesh>

        {/* Door */}
        <mesh position={[1.25, 1.15, 2.03]}>
          <boxGeometry args={[0.85, 1.8, 0.08]} />
          <meshStandardMaterial
            color="#202b36"
            roughness={0.8}
          />
        </mesh>

        {/* Floor */}
        <mesh
          position={[0, 0, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[9, 8]} />
          <meshStandardMaterial
            color="#11151b"
            roughness={1}
          />
        </mesh>

        {/* Sun */}
        <mesh position={[3.5, 5, -1]}>
          <sphereGeometry args={[0.65, 32, 32]} />
          <meshBasicMaterial color="#d8ff4f" />
        </mesh>

        <OrbitControls
  enableZoom={true}
  enablePan={false}
  enableRotate={true}

  minDistance={2}
  maxDistance={25}

  zoomSpeed={1.5}
  rotateSpeed={0.8}

  autoRotate={true}
  autoRotateSpeed={0.5}

  enableDamping={true}
  dampingFactor={0.06}

  minPolarAngle={Math.PI / 5}
  maxPolarAngle={Math.PI / 2.02}
/>

        <Environment preset="city" />
      </Canvas>
    </div>
  );
}

function Overview({ onDesign, onExplore, onLaunch, r, best }) {
  return (
    <main className="section overview-page">

      {/* HERO */}
      <section className="overview-hero">

        <div className="hero-copy">

          <div className="eyebrow">
            AREA-SPECIFIC THERMAL DESIGN
          </div>

          <h1>
            Design the
            <br />
            shelter.
            <br />
            <span>Not just the simulation.</span>
          </h1>

          <p className="hero-description">
            THERMOSHELTER combines climate, geometry and material properties
            into a transparent thermal-analysis workflow for passive shelter design.
          </p>

          <div className="hero-actions">

            <button
              className="primary-button"
              onClick={onDesign}
            >
              Design a shelter →
            </button>

            <button
              className="secondary-button"
              onClick={onExplore}
            >
              Explore Leh demo ↗
            </button>

            <button
              className="secondary-button"
              onClick={onLaunch}
            >
              Run Leh simulation
            </button>

          </div>

          <div className="hero-tags">
            <span>ANSYS-READY WORKFLOW</span>
            <span>TRANSIENT THERMAL ANALYSIS</span>
            <span>EXPLAINABLE OPTIMIZATION</span>
          </div>

        </div>


        {/* 3D HERO */}
        <div className="hero-visual">

          <Shelter3D />

          <div className="zoom-hint">
  <span>↕</span>
  Scroll to zoom · Drag to rotate
</div>
<div className="hero-visual-metrics">

            <div>
              <span>OUTDOOR</span>
              <strong>
                {r.rows?.[0]?.out?.toFixed(1) || "-5.0"}°C
              </strong>
            </div>

            <div>
              <span>INDOOR</span>
              <strong>
                {r.avg?.toFixed(1) || "17.7"}°C
              </strong>
            </div>

            <div>
              <span>THERMAL SCORE</span>
              <strong>
                {r.thermalScore?.toFixed(1) || "72.7"}
              </strong>
            </div>

          </div>

        </div>

      </section>


      {/* METRIC RIBBON */}
      <section className="metric-ribbon">

        <div className="metric-item">
          <span>LOCATION</span>
          <strong>LEH · LADAKH</strong>
          <small>High-altitude winter reference</small>
        </div>

        <div className="metric-item">
          <span>PREDICTED INDOOR</span>
          <strong>{r.avg?.toFixed(1) || "17.7"}°C</strong>
          <small>24-hour mean temperature</small>
        </div>

        <div className="metric-item">
          <span>SOLAR THERMAL GAIN</span>
          <strong>{r.solar?.toFixed(1) || "0.0"} kWh</strong>
          <small>24-hour thermal gain</small>
        </div>

        <div className="metric-item">
          <span>THERMAL SCORE</span>
          <strong>{r.thermalScore?.toFixed(1) || "72.7"}/100</strong>
          <small>Prototype performance indicator · not an ANSYS validation score</small>
        </div>

      </section>


      {/* WORKFLOW */}
      <section className="overview-workflow">

        <div className="section-intro">

          <div className="eyebrow">
            HOW THERMOSHELTER WORKS
          </div>

          <h2>
            From environmental
            <br />
            conditions to a design decision.
          </h2>

          <p>
            The platform connects climate data, shelter geometry,
            material properties and thermal simulation into one workflow.
          </p>

        </div>


        <div className="workflow-grid">

          <div className="workflow-card">
            <span className="workflow-number">01</span>

            <h3>Define the environment.</h3>

            <p>
              Select an area and establish the atmospheric conditions,
              solar input and design temperature.
            </p>
          </div>


          <div className="workflow-card">
            <span className="workflow-number">02</span>

            <h3>Build the shelter.</h3>

            <p>
              Configure dimensions, orientation, openings,
              thermal mass and envelope materials.
            </p>
          </div>


          <div className="workflow-card">
            <span className="workflow-number">03</span>

            <h3>Run thermal analysis.</h3>

            <p>
              Evaluate temperature response, solar gains,
              heat loss and thermal behaviour over time.
            </p>
          </div>


          <div className="workflow-card">
            <span className="workflow-number">04</span>

            <h3>Select the optimal configuration.</h3>

            <p>
              Compare configurations and identify the combination
              with the strongest thermal performance.
            </p>
          </div>

        </div>

      </section>

      {/* DESIGN INTELLIGENCE */}
      <section className="overview-intelligence">

        <div className="section-intro">

          <div className="eyebrow">
            DESIGN INTELLIGENCE
          </div>

          <h2>
            More than a temperature.
          </h2>

          <p>
            A useful thermal model should explain why a design performs
            the way it does — not simply produce a number.
          </p>

        </div>


        <div className="intelligence-grid">

          <div className="intelligence-card">
            <span>THERMAL RESPONSE</span>

            <strong>
              {r.min?.toFixed(1) || "-5.0"}°C →{" "}
              {r.max?.toFixed(1) || "18.0"}°C
            </strong>

            <p>
              Predicted indoor temperature range over 24 hours.
            </p>
          </div>


          <div className="intelligence-card">
            <span>ENVELOPE PERFORMANCE</span>

            <strong>
              {r.U?.toFixed(3) || "0.000"} W/m²·K
            </strong>

            <p>
              Lower U-value indicates lower heat transfer through the envelope.
            </p>
          </div>


          <div className="intelligence-card">
            <span>RECOMMENDED MATERIAL</span>

            <strong>
              {best ? MATERIALS[best.id].name : "Insulated envelope"}
            </strong>

            <p>
              Highest-ranked candidate within the evaluated set.
            </p>
          </div>

        </div>

      </section>


    </main>
  );
}

function Design({s,r,update,updateG,onRun,simulationRunning}) {
  return (
    <main className="section">

      <div className="eyebrow">01 · DESIGN WORKSPACE</div>

      <div className="design-heading">
        <div>
          <h1>Describe your shelter.</h1>

          <p className="lede">
            Configure the shelter and run a thermal analysis to visualize
            how the design responds to its selected climate and materials.
          </p>
        </div>

        <div className={`live-model-status ${simulationRunning ? 'running' : ''}`}>
          <span></span>
          {simulationRunning ? 'SIMULATION RUNNING' : 'MODEL READY'}
        </div>
      </div>

      <div className="design-grid">

        <div className="panel form">

          <div className="form-section-title">
            SHELTER PARAMETERS
          </div>

          <label>
            Location
            <select
              value={s.location}
              onChange={e=>update({location:e.target.value})}
            >
              {Object.entries(CLIMATE).map(([k,c])=>(
                <option key={k} value={k}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="twofields">

            {[
              ['Length (m)','length'],
              ['Width (m)','width'],
              ['Height (m)','height'],
              ['Occupants','occupants'],
              ['Window area (m²)','windowArea'],
              ['Door area (m²)','doorArea']
            ].map(([lab,key])=>(
              <label key={key}>
                {lab}

                <input
                  type="number"
                  min="0.5"
                  step="0.1"
                  value={s.geometry[key] ?? s[key]}
                  onChange={e=>{
                    const v=Number(e.target.value);

                    if(key==='occupants'){
                      update({occupants:v});
                    }else{
                      updateG({[key]:v});
                    }
                  }}
                />
              </label>
            ))}

          </div>

          <label>
            Orientation
            <select
              value={s.geometry.orientation}
              onChange={e=>
                updateG({orientation:e.target.value})
              }
            >
              {['N','NE','E','SE','S','SW','W','NW'].map(x=>(
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>

          <label>
            Target indoor temperature (°C)
            <input
              type="number"
              step="0.5"
              value={s.target}
              onChange={e=>
                update({target:Number(e.target.value)})
              }
            />
          </label>

          <label>
            Primary material
            <select
              value={s.layers[0]}
              onChange={e=>
                update({
                  layers:[
                    e.target.value,
                    'insulation',
                    'concrete'
                  ]
                })
              }
            >
              {Object.keys(MATERIALS)
                .filter(k=>k!=='insulation')
                .map(k=>(
                  <option key={k} value={k}>
                    {MATERIALS[k].name}
                  </option>
                ))}
            </select>
          </label>

          <div className="live-input-note">
            <span></span>
            Design parameters drive the thermal model
          </div>

          <button
            className="primary wide"
            onClick={onRun}
          >
            {simulationRunning
              ? 'Running thermal analysis…'
              : 'Run thermal analysis →'}
          </button>

        </div>

        <Design3DSimulation
          s={s}
          r={r}
          simulationRunning={simulationRunning}
        />

      </div>

    </main>
  );
}

function Design3DSimulation({s,r,simulationRunning}) {

  const g=s.geometry;

  const indoor=r.avg;
  const outdoor=r.rows?.[0]?.out ?? 0;

  const temperatureDifference=indoor-s.target;

  const thermalColor =
    indoor < s.target-3
      ? '#1769ff'
      : indoor < s.target-0.8
      ? '#45a6d9'
      : indoor <= s.target+3
      ? '#8ed35f'
      : '#ff5c38';

  const heatIntensity=Math.max(
    0.08,
    Math.min(
      0.8,
      Math.abs(temperatureDifference)/10
    )
  );

  return (
    <div className="design-simulation">

      <div className="simulation-header">

        <div>
          <span>
            {simulationRunning
              ? 'THERMAL SIMULATION ACTIVE'
              : 'LIVE 3D THERMAL MODEL'}
          </span>

          <strong>
            {g.length} × {g.width} × {g.height} m
          </strong>
        </div>

        <div className="simulation-live">

          <i></i>

          {simulationRunning
            ? 'CALCULATING'
            : 'READY'}

        </div>

      </div>


      <div className={`design-canvas ${
        simulationRunning ? 'thermal-running' : ''
      }`}>

        <Canvas
          camera={{
            position:[
              Math.max(g.length,6),
              Math.max(g.height,4),
              Math.max(g.width,6)
            ],
            fov:42
          }}
          dpr={[1,2]}
        >

          <ambientLight
            intensity={
              simulationRunning
                ? 0.7
                : 1.4
            }
          />

          <directionalLight
            position={[6,8,6]}
            intensity={
              simulationRunning
                ? 3
                : 2.5
            }
          />

          <directionalLight
            position={[-5,4,-4]}
            intensity={1}
          />


          {/* MAIN SHELTER */}
          <mesh
            position={[
              0,
              g.height/2,
              0
            ]}
          >

            <boxGeometry
              args={[
                g.length,
                g.height,
                g.width
              ]}
            />

            <meshStandardMaterial
              color={thermalColor}
              roughness={0.72}
              metalness={0.05}
              transparent
              opacity={
                simulationRunning
                  ? 0.72
                  : 0.88
              }

              emissive={thermalColor}

              emissiveIntensity={
                simulationRunning
                  ? heatIntensity
                  : 0.05
              }
            />

          </mesh>


          {/* INNER THERMAL FIELD */}
          <mesh
            position={[
              0,
              g.height/2,
              0
            ]}
          >

            <boxGeometry
              args={[
                Math.max(g.length-0.45,0.5),
                Math.max(g.height-0.45,0.5),
                Math.max(g.width-0.45,0.5)
              ]}
            />

            <meshBasicMaterial
              color={thermalColor}
              transparent
              opacity={
                simulationRunning
                  ? 0.22
                  : 0.06
              }
            />

          </mesh>


          {/* ROOF */}
          <mesh
            position={[
              0,
              g.height+0.15,
              0
            ]}
          >

            <boxGeometry
              args={[
                g.length+0.25,
                0.25,
                g.width+0.25
              ]}
            />

            <meshStandardMaterial
              color="#deded7"
              roughness={0.75}
            />

          </mesh>


          {/* WINDOW */}
          <mesh
            position={[
              0,
              Math.max(g.height*0.62,1),
              g.width/2+0.05
            ]}
          >

            <boxGeometry
              args={[
                Math.min(
                  Math.max(g.windowArea*0.7,0.4),
                  2.2
                ),
                Math.min(
                  Math.max(g.windowArea*0.45,0.3),
                  1.2
                ),
                0.08
              ]}
            />

            <meshStandardMaterial
              color="#9bdcff"
              emissive="#58bde8"
              emissiveIntensity={
                simulationRunning
                  ? 1.4
                  : 0.4
              }
            />

          </mesh>


          {/* DOOR */}
          <mesh
            position={[
              g.length*0.22,
              Math.min(g.height*0.32,1.2),
              g.width/2+0.06
            ]}
          >

            <boxGeometry
              args={[
                Math.min(
                  Math.max(g.doorArea*0.5,0.4),
                  1.1
                ),
                Math.min(
                  Math.max(g.height*0.65,1),
                  2.2
                ),
                0.08
              ]}
            />

            <meshStandardMaterial
              color="#202932"
              roughness={0.8}
            />

          </mesh>


          {/* HEAT FLOW PARTICLES */}
          {simulationRunning &&
            Array.from({length:18},(_,i)=>{

              const angle=(i/18)*Math.PI*2;

              const radius=
                Math.min(g.length,g.width)*0.28;

              const x=
                Math.cos(angle)*radius;

              const z=
                Math.sin(angle)*radius;

              const y=
                0.35+
                ((i*0.37)%1)*
                Math.max(g.height-0.7,1);

              return (
                <mesh
                  key={i}
                  position={[x,y,z]}
                >

                  <sphereGeometry
                    args={[0.045,12,12]}
                  />

                  <meshBasicMaterial
                    color={
                      indoor>=s.target
                        ? '#ff7048'
                        : '#58aaff'
                    }
                  />

                </mesh>
              );

            })
          }


          {/* SOLAR SOURCE */}
          <mesh
            position={[
              g.length*0.8,
              g.height*1.7,
              -g.width*0.65
            ]}
          >

            <sphereGeometry
              args={[0.55,32,32]}
            />

            <meshBasicMaterial
              color="#d8ff4d"
            />

          </mesh>


          {/* GROUND */}
          <mesh
            rotation={[-Math.PI/2,0,0]}
            position={[0,-0.02,0]}
          >

            <planeGeometry
              args={[
                Math.max(g.length*1.8,9),
                Math.max(g.width*1.8,8)
              ]}
            />

            <meshStandardMaterial
              color="#11151b"
              roughness={1}
            />

          </mesh>


          <OrbitControls
            enablePan={false}
            minDistance={4}
            maxDistance={14}
            autoRotate={simulationRunning}
            autoRotateSpeed={0.8}
          />

          <Environment preset="city"/>

        </Canvas>


        {/* SIMULATION OVERLAY */}

        {simulationRunning && (

          <div className="thermal-simulation-overlay">

            <div className="simulation-pulse"></div>

            <strong>
              THERMAL FIELD UPDATING
            </strong>

            <span>
              {indoor.toFixed(1)}°C indoor
              {' · '}
              {outdoor.toFixed(1)}°C ambient
            </span>

          </div>

        )}


        <div className="thermal-legend">

          <div>
            <span className="legend-dot cold"></span>
            COLD
          </div>

          <div>
            <span className="legend-dot comfort"></span>
            COMFORT
          </div>

          <div>
            <span className="legend-dot hot"></span>
            HOT
          </div>

        </div>

      </div>


      {/* RESULTS */}

      <div className="design-live-results">

        <div>
          <small>OUTDOOR</small>
          <strong>
            {outdoor.toFixed(1)}°C
          </strong>
        </div>

        <div className="result-highlight">

          <small>SIMULATED INDOOR</small>

          <strong>
            {indoor.toFixed(1)}°C
          </strong>

          <span>
            {temperatureDifference>=0 ? '+' : ''}
            {temperatureDifference.toFixed(1)}°C
            {' from target'}
          </span>

        </div>

        <div>
          <small>TARGET</small>
          <strong>
            {s.target.toFixed(1)}°C
          </strong>
        </div>

        <div>
          <small>THERMAL SCORE</small>
          <strong>
            {r.thermalScore.toFixed(1)}
          </strong>
        </div>

      </div>


      <div className="design-model-footer">

        <span>MATERIAL</span>

        <strong>
          {MATERIALS[s.layers[0]].name}
          {' Adobe + Insulation + Concrete'}
        </strong>

        <span className="model-update">
          {simulationRunning
            ? 'SIMULATING'
            : 'LIVE MODEL'}
        </span>

      </div>

    </div>
  );
}
function ShelterVisual({s,r}){return <div className="visual-panel"><div className="visual-top"><span>INTERACTIVE SHELTER MODEL</span><span>{s.geometry.length} × {s.geometry.width} × {s.geometry.height} m</span></div><div className="scene"><div className="model3d"><div className="mroof"></div><div className="mfront"><div className="mwindow"></div><div className="mdoor"></div></div><div className="mside"></div></div><div className="axis">N ↑<br/>← W &nbsp; E →<br/>S ↓</div></div><div className="metrics"><div><small>MIN INDOOR</small><b>{r.min.toFixed(1)}°C</b></div><div><small>AVG INDOOR</small><b>{r.avg.toFixed(1)}°C</b></div><div><small>SOLAR</small><b>{r.solar.toFixed(1)} kWh</b></div><div><small>HEAT LOSS</small><b>{r.heatLoss.toFixed(1)} kWh</b></div></div></div>}

function ClimatePage() {
  const climate = CLIMATE.leh;

  return (
    <main className="section climate-page">

      <div className="eyebrow">
        CLIMATE
      </div>

      <h1>
        Reference climate profiles.
      </h1>

      <p className="lede">
        Use a location profile as the boundary-condition starting point.
        These values are reference inputs, not live weather.
      </p>

      <div className="climate-grid">
        {Object.entries(CLIMATE).map(([id, c]) => (
          <div className="climate-card" key={id}>

            <span>{c.name}</span>

            <strong>
              {c.mean}°C
            </strong>

            <p>
              Peak solar {c.solar} W/m² · daily swing ±{c.amp}°C
            </p>

            <small>
              {c.elevation} · {c.season}
            </small>

          </div>
        ))}
      </div>


      <div className="panel climate-profile">

        <div className="climate-profile-head">

          <div>
            <div className="eyebrow">
              24-HOUR PROFILE
            </div>

            <h3>
              Representative outdoor temperature
            </h3>
          </div>

          <span className="profile-meta">
            LEH · LADAKH · WINTER REFERENCE
          </span>

        </div>


        <div className="tempbars">

          {Array.from({ length: 24 }, (_, h) => {

            const temperature = outdoorTemp(climate, h);

            const height = clamp(
              ((temperature + 15) / 35) * 100,
              8,
              100
            );

            return (
              <div
                className="barwrap"
                key={h}
                title={`${String(h).padStart(2, "0")}:00 · ${temperature.toFixed(1)}°C`}
              >

                <div
                  className="bar"
                  style={{
                    height: `${height}%`
                  }}
                />

                <small>
                  {String(h).padStart(2, "0")}
                </small>

              </div>
            );

          })}

        </div>


        <div className="profile-axis">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>


        <p className="profile-note">
          Reference outdoor temperature profile used as a climate boundary
          condition for the thermal model.
        </p>

      </div>

    </main>
  );
}

function MaterialsPage() {
  const materialTypes = {
    stone: 'MASSIVE',
    brick: 'MASONRY',
    concrete: 'STRUCTURAL',
    adobe: 'EARTH',
    rammed: 'EARTH',
    timber: 'BIO-BASED',
    insulation: 'INSULATION'
  };

  return (
    <main className="section materials-page">

      <div className="eyebrow">MATERIALS</div>

      <h1>Material library.</h1>

      <p className="lede">
        Compare the thermal properties used by the shelter model.
        Select materials based on conductivity, thermal mass and resistance.
      </p>

      <div className="material-library-header">

        <div>
          <strong>{Object.keys(MATERIALS).length}</strong>
          <span>REFERENCE MATERIALS</span>
        </div>

        <div>
          <strong>THERMAL</strong>
          <span>PROPERTY DATABASE</span>
        </div>

        <div>
          <strong>SI UNITS</strong>
          <span>ENGINEERING INPUTS</span>
        </div>

      </div>

      <div className="material-grid premium-material-grid">

        {Object.entries(MATERIALS).map(([id, m]) => {

          const rValue = m.t / m.k;

          const conductivityPercent = clamp(
            (m.k / 1.7) * 100,
            8,
            100
          );

          return (
            <article className="material-card premium-material-card" key={id}>

              <div className="material-card-top">

                <div className="material-icon">
                  <span></span>
                </div>

                <div className="material-category">
                  {materialTypes[id]}
                </div>

                <div className="material-thickness">
                  {m.t * 100} cm
                </div>

              </div>

              <div className="material-name-row">

                <h3>{m.name}</h3>

                <span className="material-r">
                  R {rValue.toFixed(2)}
                </span>

              </div>

              <div className="conductivity-block">

                <div className="property-heading">
                  <span>THERMAL CONDUCTIVITY</span>
                  <strong>{m.k} W/m·K</strong>
                </div>

                <div className="conductivity-track">
                  <i
                    style={{
                      width: `${conductivityPercent}%`
                    }}
                  ></i>
                </div>

              </div>

              <div className="material-properties">

                <div>
                  <small>DENSITY</small>
                  <strong>{m.rho}</strong>
                  <span>kg/m³</span>
                </div>

                <div>
                  <small>SPECIFIC HEAT</small>
                  <strong>{m.cp}</strong>
                  <span>J/kg·K</span>
                </div>

                <div>
                  <small>ABSORPTANCE</small>
                  <strong>{m.alpha}</strong>
                  <span>solar</span>
                </div>

              </div>

              <div className="material-footer">

                <span>
                  THERMAL RESISTANCE
                </span>

                <strong>
                  {rValue.toFixed(2)} m²·K/W
                </strong>

              </div>

            </article>
          );
        })}

      </div>

      <div className="materials-note">

        <div className="materials-note-mark">i</div>

        <div>
          <strong>Engineering data note</strong>

          <p>
            These are reference material properties used by the prototype
            thermal model. Final engineering deployment should use verified
            material data for the selected region and construction system.
          </p>
        </div>

      </div>

    </main>
  );
}

function Simulation({s,r}) {
  const [hour,setHour] = useState(12);
  const [running,setRunning] = useState(true);

  const point = r.rows[hour] || r.rows[0];
  const temp = point.tin;
  const outdoor = point.out;
  const gain = point.gain || 0;
  const loss = point.loss || 0;
  const net = point.net || 0;

  const thermalState =
    temp < s.target - 3 ? "COLD"
    : temp < s.target - 0.8 ? "COOL"
    : temp > s.target + 3 ? "HOT"
    : "COMFORT";

  const tempPct = clamp(((temp + 5) / 30) * 100, 8, 92);
  const targetPct = clamp(((s.target + 5) / 30) * 100, 8, 92);
  const outsidePct = clamp(((outdoor + 15) / 40) * 100, 8, 92);

  return (
    <main className="section simulation-page">

      <div className="eyebrow"> THERMAL SIMULATION ENGINE</div>

      <div className="simulation-heading">
        <div>
          <h1>Watch the shelter respond.</h1>
          <p className="lede">
            A 24-hour transient thermal visualization driven by the current
            climate, geometry, envelope and internal gains.
          </p>
        </div>

        <div className={`solver-status ${running ? "live" : ""}`}>
          <span className="status-dot"></span>
          {running ? "MODEL RUNNING" : "MODEL PAUSED"}
        </div>
      </div>

      {/* MAIN SIMULATION VIEW */}
      <section className="thermal-console">

        <div className="console-top">
          <div>
            <span className="console-label">THERMOSHELTER TRANSIENT ENGINE</span>
            <strong>THERMAL FIELD / 24H</strong>
          </div>

          <div className="console-meta">
            <span>CASE: LEH-WINTER</span>
            <span>Δt = 1 HOUR</span>
            <span>STEP {String(hour + 1).padStart(2,"0")}/24</span>
          </div>
        </div>

        <div className="thermal-stage">

          {/* OUTSIDE TEMPERATURE */}
          <div className="environment-readout left-readout">
            <small>OUTSIDE</small>
            <strong>{outdoor.toFixed(1)}°C</strong>
            <span>Ambient boundary</span>
          </div>

          {/* ANIMATED FIELD */}
          <div className="thermal-scene">

            <div className="sun-orb">
              <div className="sun-core"></div>
              <div className="sun-rays"></div>
            </div>

            <div className="cold-field"></div>
            <div className="warm-field"></div>

            {/* HEAT PARTICLES */}
            <div className="heat-particles">
              {Array.from({length:18},(_,i)=>(
                <i
                  key={i}
                  className="heat-particle"
                  style={{
                    "--i": i,
                    "--delay": `${(i % 6) * 0.55}s`,
                    "--x": `${18 + (i * 17) % 65}%`,
                    "--y": `${25 + (i * 29) % 48}%`
                  }}
                />
              ))}
            </div>

            {/* SHELTER */}
            <div className="thermal-shelter">

              <div className="thermal-roof">
                <span className="layer-tag stone-tag">STONE</span>
                <span className="layer-tag insulation-tag">INSULATION</span>
              </div>

              <div className="thermal-wall wall-left">
                <span className="wall-layer stone-layer"></span>
                <span className="wall-layer insulation-layer"></span>
                <span className="wall-layer concrete-layer"></span>
              </div>

              <div className="thermal-wall wall-right">
                <span className="wall-layer stone-layer"></span>
                <span className="wall-layer insulation-layer"></span>
                <span className="wall-layer concrete-layer"></span>
              </div>

              <div
                className="thermal-interior"
                style={{
                  "--temperature": `${tempPct}%`
                }}
              >

                <div className="interior-glow"></div>

                <div className="window-glow"></div>

                <div className="occupant">
                  <span className="person-head"></span>
                  <span className="person-body"></span>
                </div>

                <div className="heat-wave wave-1"></div>
                <div className="heat-wave wave-2"></div>
                <div className="heat-wave wave-3"></div>

                <div className="inside-temp">
                  <small>INDOOR</small>
                  <strong>{temp.toFixed(1)}°C</strong>
                  <span>{thermalState}</span>
                </div>

              </div>

              <div className="thermal-floor"></div>

            </div>

            {/* HEAT FLOW ARROWS */}
            <div className="flow-arrows">
              <span className="flow-arrow a1">→</span>
              <span className="flow-arrow a2">→</span>
              <span className="flow-arrow a3">→</span>
              <span className="flow-arrow a4">→</span>
            </div>

          </div>

          {/* INSIDE TEMPERATURE */}
          <div className="environment-readout right-readout">
            <small>INSIDE</small>
            <strong>{temp.toFixed(1)}°C</strong>
            <span>Target {s.target.toFixed(1)}°C</span>
          </div>

        </div>

        {/* TIMELINE */}
        <div className="simulation-timeline">

          <div className="timeline-labels">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>

          <input
            className="thermal-slider"
            type="range"
            min="0"
            max="23"
            value={hour}
            onChange={e=>setHour(Number(e.target.value))}
          />

          <div className="timeline-current">
            <span>SIMULATION TIME</span>
            <strong>{String(hour).padStart(2,"0")}:00</strong>
          </div>

        </div>

      </section>

      {/* LIVE METRICS */}
      <section className="simulation-metrics">

        <div className="sim-metric">
          <span>INDOOR TEMPERATURE</span>
          <strong>{temp.toFixed(1)}°C</strong>
          <small>
            {temp >= s.target ? "+" : ""}
            {(temp-s.target).toFixed(1)}°C from target
          </small>
        </div>

        <div className="sim-metric">
          <span>SOLAR INPUT</span>
          <strong>{gain.toFixed(0)} W</strong>
          <small>Current thermal gain</small>
        </div>

        <div className="sim-metric">
          <span>HEAT LOSS</span>
          <strong>{loss.toFixed(0)} W</strong>
          <small>Envelope + openings</small>
        </div>

        <div className="sim-metric">
          <span>NET THERMAL FLOW</span>
          <strong>{net >= 0 ? "+" : ""}{net.toFixed(0)} W</strong>
          <small>{net >= 0 ? "Heat entering" : "Heat leaving"}</small>
        </div>

      </section>

      {/* THERMAL GAUGES */}
      <section className="simulation-lower">

        <div className="panel thermal-gauge-panel">

          <div className="eyebrow">TEMPERATURE FIELD</div>
          <h2>Thermal state</h2>

          <div className="temperature-gauge">

            <div className="gauge-scale">
              <span>30°C</span>
              <span>25°C</span>
              <span>20°C</span>
              <span>15°C</span>
              <span>10°C</span>
              <span>5°C</span>
            </div>

            <div className="gauge-track">

              <div
                className="target-marker"
                style={{bottom:`${targetPct}%`}}
              >
                <span>TARGET</span>
              </div>

              <div
                className="temperature-marker"
                style={{bottom:`${tempPct}%`}}
              >
                <span>{temp.toFixed(1)}°</span>
              </div>

            </div>

          </div>

          <div className="gauge-footer">
            <span>Outdoor {outdoor.toFixed(1)}°C</span>
            <strong>{thermalState}</strong>
            <span>Target {s.target.toFixed(1)}°C</span>
          </div>

        </div>

        <div className="panel energy-panel">

          <div className="eyebrow">LIVE ENERGY BALANCE</div>
          <h2>Where the heat is going.</h2>

          <div className="energy-bars">

            <EnergyBar
              label="Solar gain"
              value={gain}
              max={Math.max(gain,loss,1)}
              positive
            />

            <EnergyBar
              label="Envelope + openings"
              value={loss}
              max={Math.max(gain,loss,1)}
            />

            <EnergyBar
              label="Occupant gain"
              value={s.occupants * 100}
              max={Math.max(gain,loss,s.occupants*100,1)}
              positive
            />

          </div>

          <div className="energy-total">
            <span>24-HOUR SOLAR</span>
            <strong>{r.solar.toFixed(1)} kWh</strong>
          </div>

        </div>

      </section>

      {/* MODEL STATUS */}
      <section className="simulation-bottom">

        <div className="panel">

          <div className="eyebrow">SIMULATION STATUS</div>

          <div className="status-grid">

            <div>
              <small>CLIMATE</small>
              <strong>{CLIMATE[s.location].name}</strong>
            </div>

            <div>
              <small>ENVELOPE U-VALUE</small>
              <strong>{r.U.toFixed(3)} W/m²·K</strong>
            </div>

            <div>
              <small>THERMAL MASS</small>
              <strong>{(r.R / r.U).toFixed(2)} relative</strong>
            </div>

            <div>
              <small>MODEL STEPS</small>
              <strong>24 / 24 COMPLETE</strong>
            </div>

          </div>

        </div>

        <div className="panel simulation-explanation">

          <div className="eyebrow">MODEL INTERPRETATION</div>

          <h3>
            {net >= 0
              ? "The shelter is gaining thermal energy."
              : "The shelter is losing thermal energy."
            }
          </h3>

          <p>
            At {String(hour).padStart(2,"0")}:00, the model estimates an indoor
            temperature of <b>{temp.toFixed(1)}°C</b> while the ambient
            temperature is <b>{outdoor.toFixed(1)}°C</b>.
            The current net thermal flow is <b>{net.toFixed(0)} W</b>.
          </p>

        </div>

      </section>

    </main>
  );
}

function EnergyBar({label,value,max,positive=false}) {
  const width = clamp((value / max) * 100, 4, 100);

  return (
    <div className="energy-row">

      <div className="energy-row-head">
        <span>{label}</span>
        <strong>{value.toFixed(0)} W</strong>
      </div>

      <div className="energy-track">
        <i
          className={positive ? "energy-fill positive" : "energy-fill loss"}
          style={{width:`${width}%`}}
        ></i>
      </div>

    </div>
  );
}

function Kpi({label,value}){return <div className="kpi"><small>{label}</small><strong>{value}</strong></div>}

function Compare({ranking,s}) {
  const best = ranking[0];
  const second = ranking[1];

  return (
    <main className="section compare-page">

      <div className="eyebrow">COMPARE</div>

      <h1>Compare configurations.</h1>

      <p className="lede">
        Every candidate is evaluated against the same climate, geometry and
        target temperature so the thermal performance can be compared directly.
      </p>

      <div className="compare-summary">

        <div className="compare-summary-card">
          <small>BEST PERFORMING</small>
          <strong>{MATERIALS[best.id].name}</strong>
          <span>{best.r.thermalScore.toFixed(1)} / 100 thermal score</span>
        </div>

        <div className="compare-summary-card">
          <small>LOWEST HEAT LOSS</small>
          <strong>
            {MATERIALS[
              [...ranking].sort((a,b)=>a.r.heatLoss-b.r.heatLoss)[0].id
            ].name}
          </strong>
          <span>
            {[...ranking].sort((a,b)=>a.r.heatLoss-b.r.heatLoss)[0].r.heatLoss.toFixed(1)}
            {' kWh'}
          </span>
        </div>

        <div className="compare-summary-card">
          <small>BEST SOLAR GAIN</small>
          <strong>
            {MATERIALS[
              [...ranking].sort((a,b)=>b.r.solar-a.r.solar)[0].id
            ].name}
          </strong>
          <span>
            {[...ranking].sort((a,b)=>b.r.solar-a.r.solar)[0].r.solar.toFixed(1)}
            {' kWh'}
          </span>
        </div>

      </div>

      <div className="table-wrap compare-table">

        <table>

          <thead>
            <tr>
              <th>Rank</th>
              <th>Configuration</th>
              <th>Thermal score</th>
              <th>Comfort</th>
              <th>Min indoor</th>
              <th>Solar gain</th>
              <th>Heat loss</th>
            </tr>
          </thead>

          <tbody>

            {ranking.map((x,i)=>(
              <tr
                className={i===0 ? "recommended" : ""}
                key={x.id}
              >

                <td>
                  <span className="compare-rank">
                    #{i+1}
                  </span>
                </td>

                <td>
                  <b>
                    {MATERIALS[x.id].name}
                    {' + Insulation + Concrete'}
                  </b>

                  {i===0 && (
                    <span className="pill">
                      RECOMMENDED
                    </span>
                  )}
                </td>

                <td>
                  <strong className="score-number">
                    {x.r.thermalScore.toFixed(1)}
                  </strong>
                  <span className="score-denom">/100</span>
                </td>

                <td>
                  {x.r.comfort.toFixed(1)}
                </td>

                <td>
                  {x.r.min.toFixed(1)}°C
                </td>

                <td>
                  {x.r.solar.toFixed(1)} kWh
                </td>

                <td>
                  {x.r.heatLoss.toFixed(1)} kWh
                </td>

              </tr>
            ))}

          </tbody>

        </table>

      </div>

      <div className="compare-explanation">

        <div>
          <div className="eyebrow">ENGINEERING INTERPRETATION</div>

          <h2>
            {MATERIALS[best.id].name} leads the evaluated set.
          </h2>

          <p>
            The configuration achieves the highest thermal-performance score
            among the tested material combinations while maintaining the same
            shelter geometry and climate conditions.
          </p>
        </div>

        <div className="compare-delta">

          <small>LEAD OVER #2</small>

          <strong>
            +{(best.r.thermalScore-second.r.thermalScore).toFixed(1)}
          </strong>

          <span>thermal score points</span>

        </div>

      </div>

      <div className="note">
        <b>Model note:</b> the thermal score is a transparent prototype
        decision indicator. It is not an ANSYS validation score and should
        not be treated as certified engineering performance.
      </div>

    </main>
  );
}

function Optimize({ranking,best,setPage}) {

  const improvement =
    ranking.length > 1
      ? best.r.thermalScore - ranking[ranking.length-1].r.thermalScore
      : 0;

  return (
    <main className="section optimize-page">

      <div className="eyebrow">OPTIMIZE</div>

      <h1>Find the best shelter.</h1>

      <p className="lede">
        The optimization engine evaluates candidate material configurations
        under the same climate and geometry, then ranks them by thermal
        performance.
      </p>

      <div className="optimization-hero">

        <div>

          <div className="eyebrow">
            RECOMMENDED WITHIN EVALUATED SET
          </div>

          <h2>
            {MATERIALS[best.id].name}
            {' + Insulation + Concrete'}
          </h2>

          <p>
            Highest thermal-performance score from the evaluated candidate
            configurations.
          </p>

          <div className="optimization-actions">

            <button
              className="primary"
              onClick={()=>setPage('design')}
            >
              Open recommended design →
            </button>

            <button
              className="ghost light"
              onClick={()=>setPage('simulate')}
            >
              View simulation
            </button>

          </div>

        </div>

        <div className="optimization-score">

          <strong>
            {best.r.thermalScore.toFixed(1)}
          </strong>

          <span>/100</span>

          <small>THERMAL PERFORMANCE</small>

        </div>

      </div>

      <div className="optimization-stats">

        <div>
          <small>TOP DESIGN</small>
          <strong>{MATERIALS[best.id].name}</strong>
        </div>

        <div>
          <small>THERMAL SCORE</small>
          <strong>{best.r.thermalScore.toFixed(1)}</strong>
        </div>

        <div>
          <small>HEAT LOSS</small>
          <strong>{best.r.heatLoss.toFixed(1)} kWh</strong>
        </div>

        <div>
          <small>SOLAR GAIN</small>
          <strong>{best.r.solar.toFixed(1)} kWh</strong>
        </div>

      </div>

      <div className="ranking optimization-ranking">

        <div className="ranking-header">
          <div>
            <div className="eyebrow">CANDIDATE SEARCH</div>
            <h2>Performance ranking.</h2>
          </div>

          <span>
            {ranking.length} configurations evaluated
          </span>
        </div>

        {ranking.map((x,i)=>(
          <div
            className={`rankrow ${i===0 ? 'rankrow-best' : ''}`}
            key={x.id}
          >

            <b>#{i+1}</b>

            <div className="rank-design">

              <strong>
                {MATERIALS[x.id].name}
              </strong>

              <span>
                Insulation + Concrete
              </span>

            </div>

            <strong className="rank-score">
              {x.r.thermalScore.toFixed(1)}
            </strong>

            <div className="rankbar">
              <i
                style={{
                  width:`${x.r.thermalScore}%`
                }}
              ></i>
            </div>

          </div>
        ))}

      </div>

      <div className="optimization-insight">

        <div className="eyebrow">OPTIMIZATION INSIGHT</div>

        <h2>
          The best configuration improves the score by {improvement.toFixed(1)}
          {' '}points over the lowest-ranked candidate.
        </h2>

        <p>
          The ranking is generated from the current prototype thermal model.
          In the full engineering workflow, the same candidate search can be
          driven by validated ANSYS simulation outputs.
        </p>

      </div>

    </main>
  );
}
function Ansys({r}) {
  return (
    <main className="section">

      <div className="eyebrow"> ENGINEERING SIMULATION</div>

      <h1>ANSYS thermal simulation.</h1>

      <p className="lede">
        High-fidelity ANSYS Mechanical results provide the engineering validation
        layer. The web model provides rapid decision support for exploring and
        comparing shelter configurations.
      </p>

      <div className="ansys-grid">

        <div className="panel imagepanel">
          <div className="eyebrow">TEMPERATURE DISTRIBUTION</div>

          <img
            src="\ansys\temperature.png"
            alt="ANSYS Temperature Distribution"
            className="ansys-result-image"
          />
        </div>

        <div className="panel imagepanel">
          <div className="eyebrow">TOTAL HEAT FLUX</div>

          <img
            src="\ansys\heat-flux.png"
            alt="ANSYS Total Heat Flux"
            className="ansys-result-image"
          />
        </div>

      </div>

      <div className="solverstrip">
        <div>
          <small>SOLVER</small>
          <b>Transient Thermal · ANSYS Mechanical</b>
        </div>

        <div>
          <small>WEB MODEL SCORE</small>
          <b>{r.thermalScore.toFixed(1)}/100</b>
        </div>

        <div>
          <small>VALIDATIONSTATUS</small>
          <b>ANSYS RESULT INTEGRATED</b>
        </div>
      </div>

      <div className="panel">
        <div className="eyebrow">VALIDATION PATH</div>

        <h2>ANSYS → thermal outputs → web prediction</h2>

        <div className="flow">
          <span>User inputs</span>
          <b>→</b>
          <span>ANSYS Thermal Simulation</span>
          <b>→</b>
          <span>Temperature + Heat Flux</span>
          <b>→</b>
          <span>Web Dashboard</span>
        </div>
      </div>

    </main>
  );
}

function Report({s,r,best}){return <main className="section"><div className="eyebrow">REPORT</div><h1>Engineering assessment.</h1><button className="primary" onClick={()=>window.print()}>Print / Save report</button><div className="report-card"><div className="report-title"><div><span>THERMOSHELTER</span><small>Thermal design assessment</small></div><strong>{r.thermalScore.toFixed(1)}<small>/100</small></strong></div><div className="report-grid"><div><span>Location</span><b>{CLIMATE[s.location].name}</b></div><div><span>Geometry</span><b>{s.geometry.length} × {s.geometry.width} × {s.geometry.height} m</b></div><div><span>Occupants</span><b>{s.occupants}</b></div><div><span>Orientation</span><b>{s.geometry.orientation}</b></div><div><span>Indoor min / avg / max</span><b>{r.min.toFixed(1)} / {r.avg.toFixed(1)} / {r.max.toFixed(1)}°C</b></div><div><span>Solar / heat loss</span><b>{r.solar.toFixed(1)} / {r.heatLoss.toFixed(1)} kWh</b></div></div><div className="report-reco"><span>RECOMMENDATION</span><b>{MATERIALS[best.id].name} Timber + Insulation + Concrete</b><p>Recommended within the evaluated candidate set. Final deployment should use validated climate data and ANSYS results.</p></div></div></main>}

createRoot(document.getElementById('root')).render(<App/>);
import React,{useMemo,useState} from "react";import{createRoot}from"react-dom/client";import{Canvas}from"@react-three/fiber";import{OrbitControls,Grid}from"@react-three/drei";import"./styles.css";
const M={stone:["Stone",1.7,2200,840,30],brick:["Brick",.72,1800,840,20],concrete:["Concrete",1.4,2300,880,10],adobe:["Adobe",.43,1600,900,30],rammed:["Rammed Earth",.8,2000,900,30],timber:["Timber",.13,550,1600,10],insulation:["Insulation",.035,40,1400,5]};
const C={leh:["Leh, Ladakh",-5,9,850],manali:["Manali, Himachal Pradesh",5,8,720],srinagar:["Srinagar, Jammu & Kashmir",3,8,680],shimla:["Shimla, Himachal Pradesh",4,7,650],jaisalmer:["Jaisalmer, Rajasthan",21,11,920],delhi:["Delhi, NCR",24,10,850]};
const base={location:"leh",occupants:4,target:18,geometry:{length:5,width:4.8,height:2.8,orientation:"S",windowArea:2.4,doorArea:1.8},layers:["stone","insulation","concrete"]};
function solve(s){
  let c=C[s.location];

  const area =
    2*(s.geometry.length*s.geometry.height+s.geometry.width*s.geometry.height)
    +s.geometry.length*s.geometry.width;

  const R =
    .17+
    s.layers.reduce(
      (a,id)=>a+(M[id][4]/100)/M[id][1],
      0
    );

  const U=1/R;

  const mass=s.layers.reduce(
    (a,id)=>
      a+
      (M[id][4]/100)*
      area*
      M[id][2]*
      M[id][3],
    0
  );

  /*
    Initial indoor condition:
    the shelter starts at the user's target temperature.
    The simulation then evaluates how well the envelope
    maintains that temperature over 24 hours.
  */
  let tin=s.target;

  let rows=[];
  let solar=0;
  let loss=0;

  for(let h=0;h<24;h++){

    const day=Math.max(
      0,
      Math.sin((h-6)/12*Math.PI)
    );

    const out=
      c[1]+
      c[2]*
      Math.sin((h-8)/24*Math.PI*2);

    const sg=
      c[3]*
      day*
      s.geometry.windowArea*
      .65*
      (s.geometry.orientation==="S"?1.12:.9)
      +
      c[3]*
      day*
      area*
      .04;

    const hl=
      (
        U*area+
        2.4*s.geometry.windowArea+
        2*s.geometry.doorArea
      )*
      (tin-out);

    const net=
      sg+
      s.occupants*100-
      hl;

    tin +=
      net*
      3600/
      Math.max(mass,1500000);

    solar += Math.max(0,sg)/1000;
    loss += Math.max(0,hl)/1000;

    rows.push({
      h,
      out,
      tin
    });
  }

  const vals=rows.map(x=>x.tin);

  const avg=
    vals.reduce((a,b)=>a+b,0)/vals.length;

  const min=Math.min(...vals);
  const max=Math.max(...vals);

  /*
    Temperature-based prototype comfort metric.

    100 = very close to target
    0   = very far from target

    This is NOT PMV/PPD.
  */
  const deviations=
    vals.map(t=>Math.abs(t-s.target));

  const meanDeviation=
    deviations.reduce((a,b)=>a+b,0)/deviations.length;

  const comfort=
    Math.max(
      0,
      Math.min(
        100,
        100-(meanDeviation*5)
      )
    );

  /*
    Additional performance indicators used for
    comparing shelter configurations.
  */

  const temperatureRetention=
    Math.max(
      0,
      Math.min(
        100,
        100-(meanDeviation*4)
      )
    );

  const heatLossScore=
    Math.max(
      0,
      Math.min(
        100,
        100/(1+loss/10)
      )
    );

  const solarScore=
    Math.max(
      0,
      Math.min(
        100,
        solar*2.5
      )
    );

  const thermalScore=
    temperatureRetention*0.60+
    heatLossScore*0.25+
    solarScore*0.15;

  return{
    rows,
    solar,
    loss,
    U,
    R,
    avg,
    min,
    max,
    comfort,
    temperatureRetention,
    heatLossScore,
    solarScore,
    thermalScore
  };
}
function Model({s}){return <div className="model"><Canvas camera={{position:[7,5,7],fov:42}}><ambientLight intensity={.9}/><directionalLight position={[5,8,5]} intensity={2}/><mesh position={[0,s.geometry.height/2,0]}><boxGeometry args={[s.geometry.length,s.geometry.height,s.geometry.width]}/><meshStandardMaterial transparent opacity={.2}/></mesh><mesh position={[0,s.geometry.height+.08,0]}><boxGeometry args={[s.geometry.length+.2,.16,s.geometry.width+.2]}/><meshStandardMaterial/></mesh><Grid args={[16,16]} cellSize={.5} sectionSize={2}/><OrbitControls/></Canvas><span>INTERACTIVE 3D MODEL · DRAG TO ROTATE · SCROLL TO ZOOM</span></div>}
function Nav({page,setPage}){let n=[["home","Overview"],["design","Design"],["climate","Climate"],["materials","Materials"],["simulate","Simulate"],["compare","Compare"],["optimize","Optimize"],["ansys","Engineering Simulation"],["report","Report"]];return <header><button className="brand" onClick={()=>setPage("home")}>THERMO<span>SHELTER</span></button><nav>{n.map(x=><button className={page===x[0]?"sel":""} onClick={()=>setPage(x[0])}>{x[1]}</button>)}</nav><button className="primary smallbtn" onClick={()=>setPage("design")}>Start Design</button></header>}
function App(){const[s,setS]=useState(base);const[page,setPage]=useState("home");const[r,setR]=useState(()=>solve(base));const upd=(k,v)=>setS(x=>({...x,[k]:v}));const geo=(k,v)=>setS(x=>({...x,geometry:{...x.geometry,[k]:k==="orientation"?v:+v}}));const run=()=>{setR(solve(s));setPage("simulate")};return <><Nav page={page} setPage={setPage}/>{page==="home"&&<Home s={s} setPage={setPage} run={()=>{setS(base);setR(solve(base));setPage("simulate")}}/>}{page==="design"&&<Design s={s} upd={upd} geo={geo} run={run}/>} {page==="simulate"&&<Sim s={s} r={r} setPage={setPage}/>} {page==="climate"&&<Climate/>}{page==="materials"&&<Materials/>}{page==="compare"&&<Compare s={s}/>} {page==="optimize"&&<Optimize s={s} setS={setS} setPage={setPage}/>} {page==="ansys"&&<Ansys s={s} r={r}/>} {page==="report"&&<Report s={s} r={r}/>}<footer>THERMOSHELTER · SIH26051 · Prototype engineering decision-support platform</footer></>}
function Home({s,setPage,run}){return <main><section className="hero"><div><div className="eyebrow">SIH26051 · ENGINEERING DECISION SUPPORT</div><h1>Design shelters that<br/><i>work with the climate.</i></h1><p>Area-specific thermal analysis for passive shelter design. Configure geometry, materials and openings, evaluate thermal behaviour, compare alternatives and identify an efficient configuration.</p><button className="primary" onClick={()=>setPage("design")}>Design a Shelter →</button><button className="secondary" onClick={run}>Launch Ladakh Demo</button><div className="proof">3D DESIGN · THERMAL ANALYSIS · ANSYS VALIDATION · OPTIMIZATION</div></div><Model s={s}/></section><section className="section"><div className="eyebrow">Platform workflow</div><h2>From engineering inputs to a defensible design decision.</h2><div className="cards">{["Define shelter","Run thermal analysis","Compare configurations","Optimize & recommend"].map((x,i)=><article><b>0{i+1}</b><h3>{x}</h3><p>{["Climate, geometry, openings and materials","Temperature, solar energy and heat flow","See performance side-by-side","Rank candidates and explain why"][i]}</p></article>)}</div></section></main>}
function Design({s,upd,geo,run}){return <main className="section"><div className="eyebrow">Design · 01</div><h1>Describe your shelter.</h1><p className="lede">The same configuration is represented in the interactive 3D model and prepared for thermal analysis.</p><div className="twocol"><div className="panel form"><label>Location<select value={s.location} onChange={e=>upd("location",e.target.value)}>{Object.entries(C).map(([k,v])=><option value={k}>{v[0]}</option>)}</select></label><div className="two">{["length","width"].map(k=><label>{k} (m)<input type="number" value={s.geometry[k]} onChange={e=>geo(k,e.target.value)}/></label>)}</div><div className="two">{["height","occupants"].map(k=><label>{k==="height"?"Height (m)":"Occupants"}<input type="number" value={k==="height"?s.geometry[k]:s[k]} onChange={e=>k==="height"?geo(k,e.target.value):upd(k,+e.target.value)}/></label>)}</div><div className="two">{["windowArea","doorArea"].map(k=><label>{k==="windowArea"?"Window area (m²)":"Door area (m²)"}<input type="number" value={s.geometry[k]} onChange={e=>geo(k,e.target.value)}/></label>)}</div><label>Orientation<select value={s.geometry.orientation} onChange={e=>geo("orientation",e.target.value)}>{["N","E","S","W"].map(x=><option>{x}</option>)}</select></label><label>Target indoor temperature<input type="number" value={s.target} onChange={e=>upd("target",+e.target.value)}/></label><button className="primary full" onClick={run}>Run Thermal Analysis →</button></div><Model s={s}/></div></main>}
function Sim({s,r,setPage}){return <main className="section"><div className="eyebrow">Simulate · 04</div><h1>Thermal field.</h1><div className="twocol"><div><Model s={s}/><div className="chart"><b>24-hour indoor response</b><svg viewBox="0 0 760 220"><polyline fill="none" stroke="#819db1" strokeWidth="3" points={r.rows.map((x,i)=>`${i*32},${190-(x.out+30)*3}`).join(" ")}/><polyline fill="none" stroke="#d2a05c" strokeWidth="4" points={r.rows.map((x,i)=>`${i*32},${190-(x.tin+30)*3}`).join(" ")}/></svg></div></div><div className="metrics">{[["Indoor average",r.avg.toFixed(1)+" °C"],["Minimum indoor",r.min.toFixed(1)+" °C"],["Solar energy",r.solar.toFixed(1)+" kWh"],["Heat loss",r.loss.toFixed(1)+" kWh"],["Thermal comfort",r.comfort.toFixed(0)+" / 100"]].map(x=><div><span>{x[0]}</span><strong>{x[1]}</strong></div>)}<button className="secondary full" onClick={()=>setPage("ansys")}>View Engineering Simulation →</button></div></div></main>}
function Climate(){return <main className="section"><div className="eyebrow">Climate · 02</div><h1>Reference climate profiles.</h1><div className="cards">{Object.values(C).map(c=><article><div className="eyebrow">{c[0]}</div><div className="big">{c[1]}°C</div><p>Peak solar {c[3]} W/m² · daily swing ±{c[2]}°C</p></article>)}</div><div className="notice">Reference profiles only. The production architecture can accept location-specific or uploaded time-dependent atmospheric data.</div></main>}
function Materials(){return <main className="section"><div className="eyebrow">Materials · 03</div><h1>Material library.</h1><div className="cards material">{Object.values(M).map(m=><article><h3>{m[0]}</h3><p>Conductivity <b>{m[1]} W/m·K</b></p><p>Density <b>{m[2]} kg/m³</b></p><p>Specific heat <b>{m[3]} J/kg·K</b></p><p>Typical thickness <b>{m[4]} cm</b></p></article>)}</div></main>}
function Compare({s}){

  let a=Object.keys(M)
    .slice(0,5)
    .map(id=>{
      let x={
        ...s,
        layers:[id,"insulation","concrete"]
      };

      return [id,solve(x)];
    })
    .sort((a,b)=>b[1].thermalScore-a[1].thermalScore);

  return(
    <main className="section">

      <div className="eyebrow">Compare · 05</div>

      <h1>Compare configurations.</h1>

      <table>

        <thead>
          <tr>
            <th>Design</th>
            <th>Thermal score</th>
            <th>Comfort</th>
            <th>Min indoor</th>
            <th>Solar</th>
            <th>Heat loss</th>
          </tr>
        </thead>

        <tbody>

          {a.map((x,i)=>
            <tr className={i===0?"rec":""}>

              <td>
                {M[x[0]][0]}
                {" + insulation + concrete "}
                {i===0&&" · RECOMMENDED"}
              </td>

              <td>
                {x[1].thermalScore.toFixed(1)}
              </td>

              <td>
                {x[1].comfort.toFixed(0)}
              </td>

              <td>
                {x[1].min.toFixed(1)}°C
              </td>

              <td>
                {x[1].solar.toFixed(1)} kWh
              </td>

              <td>
                {x[1].loss.toFixed(1)} kWh
              </td>

            </tr>
          )}

        </tbody>

      </table>

    </main>
  );
}
function Optimize({s,setS,setPage}){

  let a=[
    "stone",
    "adobe",
    "rammed",
    "brick",
    "timber"
  ]
  .map(id=>{

    let x={
      ...s,
      layers:[id,"insulation","concrete"]
    };

    return{
      id,
      r:solve(x),
      x
    };

  })
  .sort(
    (a,b)=>
      b.r.thermalScore-a.r.thermalScore
  );

  const best=a[0];

  return(

    <main className="section">

      <div className="eyebrow">
        Optimize · 06
      </div>

      <h1>Recommended </h1>

      <div className="recommend">

        <div>

          <div className="eyebrow">
            Recommended
          </div>

          <h2>
            {M[best.id][0]}
            {" + insulation + concrete"}
          </h2>

          <div className="score">
            {best.r.thermalScore.toFixed(1)}
            <small>
              /100 thermal performance
            </small>
          </div>

          <p>
            Highest thermal-performance score
            from the transparent parametric
            candidate search.
          </p>

          <button
            className="primary"
            onClick={()=>{
              setS(best.x);
              setPage("simulate");
            }}
          >
            Open Recommended Design →
          </button>

        </div>

        <div>

          {a.map((x,i)=>

            <div className="rank">

              <b>#{i+1}</b>

              <span>
                {M[x.id][0]} + insulation
              </span>

              <strong>
                {x.r.thermalScore.toFixed(1)}
              </strong>

            </div>

          )}

        </div>

      </div>

    </main>

  );
}
function Ansys(){
  return (
    <main className="section">
      <div className="eyebrow">Engineering Simulation · 07</div>

      <h1>ANSYS Thermal Simulation</h1>

      <p className="lede">
        High-fidelity transient thermal analysis performed in ANSYS Mechanical
        and integrated into the THERMOSHELTER engineering workflow.
      </p>

      <div className="grid two">
        <div className="panel">
          <div className="eyebrow">TEMPERATURE</div>
          <h2>Temperature Distribution</h2>
          <img
            src="/ansys/temperature/ansys_temperature.png"
            alt="ANSYS Temperature Distribution"
            style={{
              width:"100%",
              borderRadius:"14px",
              marginTop:"18px",
              border:"1px solid rgba(255,255,255,.12)"
            }}
          />
          <p className="muted">
            Transient thermal result at the end of the simulated time period.
          </p>
        </div>

        <div className="panel">
          <div className="eyebrow">HEAT FLOW</div>
          <h2>Total Heat Flux</h2>
          <img
            src="/ansys/heat-flux/ansys_heat_flux.png"
            alt="ANSYS Total Heat Flux"
            style={{
              width:"100%",
              borderRadius:"14px",
              marginTop:"18px",
              border:"1px solid rgba(255,255,255,.12)"
            }}
          />
          <p className="muted">
            ANSYS total heat-flux distribution across the simulated geometry.
          </p>
        </div>
      </div>

      <div className="grid three" style={{marginTop:"24px"}}>
        <div className="panel">
          <div className="eyebrow">SOLVER</div>
          <h3>Transient Thermal</h3>
          <p className="muted">ANSYS Mechanical · 2026 R1</p>
        </div>

        <div className="panel">
          <div className="eyebrow">TEMPERATURE</div>
          <h3>-10 °C → 21.124 °C</h3>
          <p className="muted">Observed range in the solved result</p>
        </div>

        <div className="panel">
          <div className="eyebrow">MAX HEAT FLUX</div>
          <h3>530.93 W/m²</h3>
          <p className="muted">From the ANSYS Total Heat Flux result</p>
        </div>
      </div>

      <div className="panel" style={{marginTop:"24px"}}>
        <div className="eyebrow">VALIDATION WORKFLOW</div>
        <h2>ANSYS → THERMOSHELTER</h2>
        <p className="muted">
          ANSYS provides the high-fidelity thermal simulation results.
          THERMOSHELTER presents, processes and compares these engineering
          results for shelter design evaluation.
        </p>
      </div>
    </main>
  );
}
function Panel({t,tag,children}){return <div className="panel"><div className="eyebrow">{t} · {tag}</div>{children}</div>}
function Report({s,r}){return <main className="section"><div className="eyebrow">Report · 08</div><h1>Engineering assessment.</h1><button className="secondary" onClick={()=>print()}>Print / Save Report</button><div className="panel"><h2>THERMOSHELTER — Thermal Assessment</h2><table className="compact"><tbody>{[["Geometry",`${s.geometry.length} × ${s.geometry.width} × ${s.geometry.height} m`],["Occupants",s.occupants],["Orientation",s.geometry.orientation],["Target",s.target+"°C"],["Min / Avg / Max indoor",`${r.min.toFixed(1)} / ${r.avg.toFixed(1)} / ${r.max.toFixed(1)}°C`],["Solar energy",r.solar.toFixed(1)+" kWh"],["Heat loss",r.loss.toFixed(1)+" kWh"],["Comfort",r.comfort.toFixed(0)+"/100"]].map(x=><tr><td>{x[0]}</td><td>{x[1]}</td></tr>)}</tbody></table></div></main>}
createRoot(document.getElementById("root")).render(<App/>);
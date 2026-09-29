import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import {
  buildV3Payload,
  buildHourlyPredictionRequest,
  buildV3CandidatePayloads,
  buildV3OptimizationPayloads,
  diagnoseV3Payload,
  evaluateV3CandidatePayloads,
  getDisplayedOutdoorTemperatureForClimate,
  requestV3Prediction,
  requestHourlyPrediction,
  selectHourlyIndoorTemperature,
  rankV3CandidatesByTarget,
  scaleV3WallThickness,
} from './api.js';
import { CLIMATE_PROFILES, usesForecastBackedClimate } from './climateProfiles.js';
import { FALLBACK_MATERIALS } from './materials.js';
import {
  buildDesignSnapshot,
  createPersistenceClient,
  latestHistoricalHourly,
  latestHistoricalSummary,
  normalizeMaterialLibrary,
  restoreSavedDesign,
} from './persistence.js';
import { OPEN_METEO_ATTRIBUTION, fetchHourlyWeatherProfile } from './weather.js';
import { OperationProgress, V3PredictionGrid, v3OutputRows } from './v3ResultUi.js';
import './styles.css';

const CLIMATE = CLIMATE_PROFILES;

const BASE = {
  location:'leh', occupants:4, target:18, priority:'comfort',
  geometry:{ length:5, width:4.8, height:2.8, orientation:'S', windowArea:2.4, doorArea:1.8 },
  layers:['stone','insulation','concrete'],
};

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

function setMonotonicProgress(setter, progress, maxPercent = 100) {
  setter((previous) => {
    const percent = Math.max(previous?.percent || 0, Math.min(maxPercent, progress?.percent || 0));
    const label = typeof progress?.label === 'string'
      ? progress.label.replace(/—\s*\d+%$/, `— ${percent}%`)
      : previous?.label;
    return { ...progress, percent, label };
  });
}

function App(){
  const [page,setPage]=useState('overview');
  const navRef=useRef(null);
  const [s,setS]=useState(BASE);
  const [materials,setMaterials]=useState(FALLBACK_MATERIALS);
  const [materialStatus,setMaterialStatus]=useState({loading:true,source:'local_fallback',warning:''});
  const [materialProgress,setMaterialProgress]=useState({percent:15,label:'Loading the material catalog — 15%'});
  const [savedDesigns,setSavedDesigns]=useState([]);
  const [savedDesignsLoading,setSavedDesignsLoading]=useState(false);
  const [savedDesignError,setSavedDesignError]=useState('');
  const [savedDesignName,setSavedDesignName]=useState('Leh shelter design');
  const [saveDesignLoading,setSaveDesignLoading]=useState(false);
  const [designProgress,setDesignProgress]=useState(null);
  const [savedDesignId,setSavedDesignId]=useState(null);
  const [designHistory,setDesignHistory]=useState(null);
  const [storageNotice,setStorageNotice]=useState('');
  const persistence=useMemo(()=>createPersistenceClient(),[]);
  const [toast,setToast]=useState('');
  const [v3Prediction,setV3Prediction]=useState(null);
  const [v3CaseWeatherProfile,setV3CaseWeatherProfile]=useState(null);
  const [v3PredictionLoading,setV3PredictionLoading]=useState(false);
  const [v3PredictionProgress,setV3PredictionProgress]=useState(null);
  const [v3PredictionError,setV3PredictionError]=useState('');
  const [v3Diagnostics,setV3Diagnostics]=useState({numericOutOfRange:[],invalidNumericInputs:[],unsupportedCategories:[]});
  const v3PredictionRunId=useRef(0);
  const [candidateEvaluation,setCandidateEvaluation]=useState({status:'idle',rows:[],errors:[]});
  const [optimizationEvaluation,setOptimizationEvaluation]=useState({status:'idle',rows:[],errors:[]});
  const [candidateProgress,setCandidateProgress]=useState(null);
  const [optimizationProgress,setOptimizationProgress]=useState(null);
  const v3CandidateRequestCache=useRef(new Map());
  const candidateEvaluationRunId=useRef(0);
  const optimizationRunId=useRef(0);
  const [hourlyPrediction,setHourlyPrediction]=useState(null);
  const [hourlyPredictionLoading,setHourlyPredictionLoading]=useState(false);
  const [hourlyProgress,setHourlyProgress]=useState(null);
  const [hourlyPredictionError,setHourlyPredictionError]=useState('');
  const [hourlyPredictionErrorDetail,setHourlyPredictionErrorDetail]=useState('');
  const [hourlyWeatherProfile,setHourlyWeatherProfile]=useState(null);
  const [hourlyRequestPayload,setHourlyRequestPayload]=useState(null);
  const hourlyRunId=useRef(0);
  useEffect(()=>{
    window.scrollTo(0,0);
    if(!['overview','climate','materials','design'].includes(page)&&navRef.current){
      navRef.current.scrollLeft=0;
    }
  },[page]);
  useEffect(()=>{
    let active=true;
    const refreshMaterials=async()=>{
      try{
        const response=await persistence.getMaterials({onProgress:(progress)=>{if(active) setMaterialProgress(progress);}});
        const normalized=normalizeMaterialLibrary(response);
        const requiredIds=Object.keys(FALLBACK_MATERIALS);
        if(requiredIds.some(id=>!normalized[id])||Object.keys(normalized).some(id=>!requiredIds.includes(id))){
          throw new Error('The stored catalog must contain exactly the existing THERMOSHELTER materials.');
        }
        if(active){
          setMaterials(normalized);
          setMaterialStatus({loading:false,source:response.source||'firestore',warning:response.warning||''});
        }
      }catch(error){
        if(active){
          setMaterials(FALLBACK_MATERIALS);
          setMaterialStatus({loading:false,source:'local_fallback',warning:error?.message||'Material data could not be loaded.'});
        }
      }finally{
        if(active) setMaterialProgress(null);
      }
    };
    void refreshMaterials();
    return ()=>{active=false;};
  },[persistence]);
  const clearHourlyPrediction=()=>{
    hourlyRunId.current+=1;
    setHourlyPrediction(null);
    setHourlyPredictionError('');
    setHourlyPredictionErrorDetail('');
    setHourlyWeatherProfile(null);
    setHourlyRequestPayload(null);
    setHourlyProgress(null);
    setHourlyPredictionLoading(false);
  };
  const invalidateV3Prediction=()=>{
    v3PredictionRunId.current+=1;
    setV3Prediction(null);
    setV3CaseWeatherProfile(null);
    setV3PredictionError('');
    setV3PredictionProgress(null);
    setV3PredictionLoading(false);
    setV3Diagnostics({numericOutOfRange:[],invalidNumericInputs:[],unsupportedCategories:[]});
  };
  const clearSavedDesignContext=()=>{
    setSavedDesignId(null);
    setDesignHistory(null);
    setSavedDesignError('');
  };
  const update=(patch)=>{
    setS(v=>({...v,...patch}));
    clearSavedDesignContext();
    setStorageNotice('');
    clearHourlyPrediction();
    invalidateV3Prediction();
    resetCandidateEvaluation();
  };
  const updateG=(patch)=>{
    setS(v=>({...v,geometry:{...v.geometry,...patch}}));
    clearSavedDesignContext();
    setStorageNotice('');
    clearHourlyPrediction();
    invalidateV3Prediction();
    resetCandidateEvaluation();
  };
  const notify=(msg)=>{setToast(msg);setTimeout(()=>setToast(''),2400)};
  const resetCandidateEvaluation=()=>{
    candidateEvaluationRunId.current+=1;
    optimizationRunId.current+=1;
    v3CandidateRequestCache.current.clear();
    setCandidateEvaluation({status:'idle',rows:[],errors:[]});
    setOptimizationEvaluation({status:'idle',rows:[],errors:[]});
    setCandidateProgress(null);
    setOptimizationProgress(null);
  };
  const persistenceSnapshot=(design,weatherProfile=null)=>buildDesignSnapshot(
    design,
    CLIMATE[design.location]||{},
    materials,
    weatherProfile,
  );
  const refreshSavedDesignList=async({showProgress=true}={})=>{
    setSavedDesignsLoading(true);
    setSavedDesignError('');
    if(showProgress) setDesignProgress({percent:15,label:'Loading saved designs — 15%'});
    try{
      const response=await persistence.listDesigns({onProgress:(progress)=>{
        if(showProgress) setMonotonicProgress(setDesignProgress,progress);
      }});
      setSavedDesigns(Array.isArray(response?.designs)?response.designs:[]);
      if(showProgress) setDesignProgress({percent:90,label:'Saved design list ready — 90%'});
    }catch(error){
      setSavedDesigns([]);
      setSavedDesignError(error?.message||'Saved designs could not be loaded.');
    }finally{
      setSavedDesignsLoading(false);
      if(showProgress) setDesignProgress(null);
    }
  };
  const openDesignWorkspace=()=>{
    setPage('design');
    void refreshSavedDesignList();
  };
  const saveCurrentDesign=async()=>{
    setSaveDesignLoading(true);
    setDesignProgress({percent:15,label:'Preparing the design snapshot — 15%'});
    setStorageNotice('');
    try{
      const snapshot=persistenceSnapshot(s);
      const response=await persistence.saveDesign({
        name:savedDesignName.trim()||'Untitled shelter',
        design:snapshot.design,
        climate:snapshot.climate,
        materials:snapshot.materials,
        ...(savedDesignId?{design_id:savedDesignId}:{}),
      },{onProgress:(progress)=>setMonotonicProgress(setDesignProgress,progress,75)});
      const saved=response?.design;
      if(!saved?.id) throw new Error('The backend did not return the saved design identifier.');
      setSavedDesignId(saved.id);
      setSavedDesignName(saved.name||'Untitled shelter');
      setDesignHistory(null);
      setStorageNotice('Design saved. Run an analysis to save results for this design.');
      setDesignProgress({percent:90,label:'Design saved; refreshing the list — 90%'});
      await refreshSavedDesignList({showProgress:false});
      notify('Shelter design saved.');
    }catch(error){
      setStorageNotice(`Design was not saved: ${error?.message||'Firestore is unavailable.'}`);
    }finally{
      setSaveDesignLoading(false);
      setDesignProgress(null);
    }
  };
  const loadSavedDesign=async(designId)=>{
    if(!designId) return;
    setSavedDesignsLoading(true);
    setDesignProgress({percent:15,label:'Loading the saved design — 15%'});
    setSavedDesignError('');
    try{
      const response=await persistence.loadDesign(designId,{onProgress:(progress)=>setMonotonicProgress(setDesignProgress,progress,50)});
      const restored=restoreSavedDesign(response?.design,materials,Object.keys(CLIMATE));
      setDesignProgress({percent:60,label:'Loading saved result history — 60%'});
      let history=null;
      let historyWarning='';
      try{
        history=await persistence.getDesignHistory(designId,{onProgress:(progress)=>setMonotonicProgress(setDesignProgress,progress,85)});
      }catch(error){
        historyWarning=` The design loaded, but its saved result history could not be read: ${error?.message||'request failed'}`;
      }
      setS(restored.design);
      setSavedDesignId(restored.designId);
      setSavedDesignName(response.design.name||'Untitled shelter');
      setDesignHistory(history?{...history,design_id:designId}:null);
      clearHourlyPrediction();
      invalidateV3Prediction();
      resetCandidateEvaluation();
      setStorageNotice(`Loaded saved design. Historical results are labeled separately; run analysis for a current result.${historyWarning}`);
      setDesignProgress({percent:90,label:'Saved design restored — 90%'});
      setPage('design');
      notify('Saved design loaded. Run a new analysis for current results.');
    }catch(error){
      setSavedDesignError(error?.message||'The saved design is missing or invalid.');
    }finally{
      setSavedDesignsLoading(false);
      setDesignProgress(null);
    }
  };
  const persistPrediction=async({design,designId,modelVersion,kind,result,diagnostics,weatherProfile=null})=>{
    const snapshot=persistenceSnapshot(design,weatherProfile);
    try{
      const response=await persistence.savePrediction({
        ...snapshot,
        ...(designId?{design_id:designId}:{}),
        model_version:modelVersion,
        prediction_kind:kind,
        result,
        diagnostics,
      });
      if(!response?.prediction?.id) throw new Error('The saved prediction identifier was not returned.');
      setStorageNotice(designId
        ? `${kind==='hourly'?'Hourly':'V3 summary'} prediction saved to this design's history.`
        : `${kind==='hourly'?'Hourly':'V3 summary'} prediction saved with a reproducible scenario snapshot.`);
    }catch(error){
      setStorageNotice(`Prediction completed but was not saved: ${error?.message||'Firestore is unavailable.'}`);
    }
  };
  const persistOptimization=async({design,designId,rows,weatherProfile=null})=>{
    const snapshot=persistenceSnapshot(design,weatherProfile);
    const ranked=rankV3CandidatesByTarget(rows,design.target);
    const selected=ranked[0]||null;
    const candidates=rows.map((row)=>({
      label:row.label,
      configuration:row.configuration,
      prediction:row.prediction,
      diagnostics:row.diagnostics,
      error:row.error||null,
      targetDeviationC:row.prediction
        ? Math.abs(row.prediction.predictions.Average_Air_Temperature_C-design.target)
        : null,
    }));
    try{
      const response=await persistence.saveOptimizationRun({
        design:snapshot.design,
        climate:snapshot.climate,
        materials:snapshot.materials,
        ...(designId?{design_id:designId}:{}),
        search_scope:{
          method:'balanced V3 design-space screen',
          varied_parameters:['primary_material','wall_thickness','length','width','height','orientation','window_area','door_area'],
          fixed_location:design.location,
          fixed_target_temperature_C:design.target,
          successful_candidate_count:rows.filter((row)=>row.prediction).length,
        },
        candidate_count:candidates.length,
        candidates,
        selected_candidate:selected?{
          label:selected.label,
          configuration:selected.configuration,
          prediction:selected.prediction,
          target_deviation_C:selected.targetDeviationC,
        }:null,
        metric:'Absolute target gap: |V3 Average_Air_Temperature_C − target temperature|, in °C',
      });
      if(!response?.optimization_run?.id) throw new Error('The saved optimization identifier was not returned.');
      setStorageNotice(designId
        ? 'V3 design-space search saved to this design history.'
        : 'V3 design-space search saved with a reproducible scenario snapshot.');
    }catch(error){
      setStorageNotice(`Optimization completed but was not saved: ${error?.message||'Firestore is unavailable.'}`);
    }
  };
  const runCandidateEvaluation=async()=>{
    if(candidateEvaluation.status==='loading') return;
    const operationId=++candidateEvaluationRunId.current;
    setCandidateEvaluation({status:'loading',rows:[],errors:[]});
    setCandidateProgress({percent:10,label:'Preparing six material assemblies — 10%',completed:0,total:6});
    try{
      let weatherProfile=null;
      if(usesForecastBackedClimate(s.location)){
        setCandidateProgress({percent:15,label:'Fetching Bengaluru case weather from Open-Meteo — 15%',completed:0,total:6});
        weatherProfile=await fetchHourlyWeatherProfile(s.location);
        if(operationId!==candidateEvaluationRunId.current) return;
      }
      const climateOverride=weatherProfile?.caseClimateSummary||null;
      const candidates=buildV3CandidatePayloads(s,materials,CLIMATE,climateOverride);
      const progressBase=climateOverride?20:15;
      setCandidateProgress({percent:progressBase,label:`Prepared ${candidates.length} material requests — ${progressBase}%`,completed:0,total:candidates.length});
      const rows=await evaluateV3CandidatePayloads(candidates,v3CandidateRequestCache.current,requestV3Prediction,{
        onCandidateComplete:({completed,total})=>{
          if(operationId!==candidateEvaluationRunId.current) return;
          setCandidateProgress({
            percent:progressBase+Math.round((completed/total)*(90-progressBase)),
            label:`V3 material predictions returned (${completed}/${total}) — ${progressBase+Math.round((completed/total)*(90-progressBase))}%`,
            completed,
            total,
          });
        },
        onApiProgress:(progress)=>{
          if(operationId!==candidateEvaluationRunId.current
            ||!['connecting','recovering','ready','retrying'].includes(progress.phase)) return;
          setCandidateProgress((previous)=>previous?{
            ...previous,
            label:`${progress.label.replace(/—\s*\d+%$/,'')} · ${previous.completed||0}/${previous.total||candidates.length} candidates returned — ${previous.percent}%`,
          }:previous);
        },
      });
      if(operationId!==candidateEvaluationRunId.current) return;
      const failures=rows.filter(row=>row.error).map(row=>({candidate:row.label,message:row.error}));
      const successfulCount=rows.filter(row=>row.prediction).length;
      setCandidateEvaluation({
        status:failures.length?(successfulCount?'partial':'error'):'success',
        rows,
        errors:failures,
      });
      setCandidateProgress(null);
    }catch(error){
      if(operationId!==candidateEvaluationRunId.current) return;
      setCandidateEvaluation({
        status:'error',
        rows:[],
        errors:[{candidate:'Candidate set',message:error?.message||'Unable to evaluate candidates.'}],
      });
      setCandidateProgress(null);
    }
  };
  const runOptimizationSearch=async()=>{
    if(optimizationEvaluation.status==='loading') return;
    const operationId=++optimizationRunId.current;
    setOptimizationEvaluation({status:'loading',rows:[],errors:[]});
    setOptimizationProgress({percent:10,label:'Preparing the V3 design-space search — 10%',completed:0,total:36});
    try{
      const designAtStart={...s,geometry:{...s.geometry},layers:[...s.layers]};
      const designIdAtStart=savedDesignId;
      let weatherProfile=null;
      if(usesForecastBackedClimate(designAtStart.location)){
        setOptimizationProgress({percent:15,label:'Fetching Bengaluru case weather from Open-Meteo — 15%',completed:0,total:36});
        weatherProfile=await fetchHourlyWeatherProfile(designAtStart.location);
        if(operationId!==optimizationRunId.current) return;
      }
      const climateOverride=weatherProfile?.caseClimateSummary||null;
      const candidates=buildV3OptimizationPayloads(designAtStart,materials,CLIMATE,climateOverride);
      const progressBase=climateOverride?20:15;
      setOptimizationProgress({percent:progressBase,label:`Prepared ${candidates.length} candidate inputs — ${progressBase}%`,completed:0,total:candidates.length});
      const rows=await evaluateV3CandidatePayloads(candidates,v3CandidateRequestCache.current,requestV3Prediction,{
        onCandidateComplete:({completed,total})=>{
          if(operationId!==optimizationRunId.current) return;
          setOptimizationProgress({
            percent:progressBase+Math.round((completed/total)*(90-progressBase)),
            label:`V3 candidates evaluated (${completed}/${total}) — ${progressBase+Math.round((completed/total)*(90-progressBase))}%`,
            completed,
            total,
          });
        },
        onApiProgress:(progress)=>{
          if(operationId!==optimizationRunId.current
            ||!['connecting','recovering','ready','retrying'].includes(progress.phase)) return;
          setOptimizationProgress((previous)=>previous?{
            ...previous,
            label:`${progress.label.replace(/—\s*\d+%$/,'')} · ${previous.completed||0}/${previous.total||candidates.length} candidates returned — ${previous.percent}%`,
          }:previous);
        },
      });
      if(operationId!==optimizationRunId.current) return;
      const failures=rows.filter(row=>row.error).map(row=>({candidate:row.label,message:row.error}));
      const successfulCount=rows.filter(row=>row.prediction).length;
      setOptimizationEvaluation({
        status:failures.length?(successfulCount?'partial':'error'):'success',
        rows,
        errors:failures,
      });
      if(successfulCount>0){
        void persistOptimization({design:designAtStart,designId:designIdAtStart,rows,weatherProfile});
      }
      setOptimizationProgress(null);
    }catch(error){
      if(operationId!==optimizationRunId.current) return;
      setOptimizationEvaluation({
        status:'error',
        rows:[],
        errors:[{candidate:'Optimization search',message:error?.message||'Unable to build the V3 search.'}],
      });
      setOptimizationProgress(null);
    }
  };
  const applyCandidate=(materialId)=>{
    const selectedMaterialId=typeof materialId==='string'?materialId:materialId?.id;
    if(!selectedMaterialId) return;
    update({layers:[selectedMaterialId,'insulation','concrete']});
    openDesignWorkspace();
  };
  const applyOptimizationCandidate=(candidate)=>{
    if(!candidate?.configuration) return;
    update({
      layers:[...candidate.configuration.layers],
      layerThicknesses:[...candidate.configuration.layerThicknesses],
      geometry:{...candidate.configuration.geometry},
    });
    openDesignWorkspace();
  };
  const runV3Prediction=async()=>{
    const operationId=++v3PredictionRunId.current;
    const designAtStart={...s,geometry:{...s.geometry},layers:[...s.layers]};
    const designIdAtStart=savedDesignId;
    setV3PredictionLoading(true);
    setV3PredictionProgress({percent:15,label:'Preparing current design inputs — 15%'});
    setV3PredictionError('');
    setV3Prediction(null);
    setV3CaseWeatherProfile(null);
    setV3Diagnostics({numericOutOfRange:[],invalidNumericInputs:[],unsupportedCategories:[]});
    try{
      let weatherProfile=null;
      if(usesForecastBackedClimate(designAtStart.location)){
        setV3PredictionProgress({percent:20,label:'Fetching Bengaluru case weather from Open-Meteo — 20%'});
        weatherProfile=await fetchHourlyWeatherProfile(designAtStart.location);
        if(operationId!==v3PredictionRunId.current) return;
        setV3PredictionProgress({percent:30,label:'Forecast received; preparing V3 model inputs — 30%'});
      }
      const climateOverride=weatherProfile?.caseClimateSummary||null;
      const payload=buildV3Payload(
        designAtStart,
        materials,
        CLIMATE,
        climateOverride?.External_Temperature_C
          ?? getDisplayedOutdoorTemperatureForClimate(CLIMATE[designAtStart.location]),
        climateOverride,
      );
      const diagnostics=diagnoseV3Payload(payload);
      setV3Diagnostics(diagnostics);
      if(diagnostics.invalidNumericInputs.length||diagnostics.unsupportedCategories.length){
        setV3PredictionError(diagnostics.unsupportedCategories.length
          ? 'The selected material/category is not supported by the summary model. Choose a supported option and try again.'
          : 'One or more numeric inputs are not finite numbers. Check the design values and try again.');
        return;
      }
      const result=await requestV3Prediction(payload,{onProgress:(progress)=>{
        if(operationId===v3PredictionRunId.current) setV3PredictionProgress(progress);
      }});
      if(operationId!==v3PredictionRunId.current) return;
      setV3Prediction(result);
      setV3CaseWeatherProfile(weatherProfile);
      void persistPrediction({
        design:designAtStart,
        designId:designIdAtStart,
        modelVersion:'V3',
        kind:'summary',
        result,
        diagnostics,
        weatherProfile,
      });
    }catch(error){
      if(operationId!==v3PredictionRunId.current) return;
      const errorMessage = typeof error?.message === 'string' && error.message.trim()
        ? error.message
        : 'The thermal prediction could not be completed. Check the design inputs and try again.';
      setV3PredictionError(errorMessage);
    }finally{
      if(operationId===v3PredictionRunId.current){
        setV3PredictionLoading(false);
        setV3PredictionProgress(null);
      }
    }
  };
  const runHourlyPrediction=async(design=s)=>{
    const designAtStart={...design,geometry:{...design.geometry},layers:[...design.layers]};
    const designIdAtStart=design===s?savedDesignId:null;
    const operationId=++hourlyRunId.current;
    setHourlyPredictionLoading(true);
    setHourlyProgress({percent:10,label:'Preparing the hourly forecast request — 10%'});
    setHourlyPrediction(null);
    setHourlyPredictionError('');
    setHourlyPredictionErrorDetail('');
    setHourlyWeatherProfile(null);
    setHourlyRequestPayload(null);
    try{
      setHourlyProgress({percent:20,label:'Fetching the next local-day forecast — 20%'});
      const weather=await fetchHourlyWeatherProfile(designAtStart.location);
      if(operationId!==hourlyRunId.current) return;
      setHourlyWeatherProfile(weather);
      setHourlyProgress({percent:45,label:'Forecast received; preparing 24 hourly model inputs — 45%'});
      const payload=buildHourlyPredictionRequest(designAtStart,materials,CLIMATE,weather);
      const diagnostics=diagnoseV3Payload(payload.case_inputs);
      if(diagnostics.invalidNumericInputs.length||diagnostics.unsupportedCategories.length){
        throw new Error(diagnostics.unsupportedCategories.length
          ? 'The selected material/category is not supported by the hourly model.'
          : 'A case input is missing or non-finite. Check the design values and try again.');
      }
      setHourlyRequestPayload(payload);
      const result=await requestHourlyPrediction(payload,{onProgress:(progress)=>{
        if(operationId===hourlyRunId.current) setMonotonicProgress(setHourlyProgress,progress);
      }});
      if(operationId!==hourlyRunId.current) return;
      if(!Array.isArray(result?.hours)||result.hours.length!==24
        ||result.hours.some((value,index)=>value!==index)
        ||!Array.isArray(result?.predicted_indoor_temperature_C)
        ||result.predicted_indoor_temperature_C.length!==24
        ||result.predicted_indoor_temperature_C.some(value=>typeof value!=='number'||!Number.isFinite(value))){
        throw new Error('The hourly API response did not contain 24 finite temperatures for hours 0–23.');
      }
      setHourlyProgress({percent:95,label:'Validated all 24 hourly temperatures — 95%'});
      setHourlyPrediction(result);
      void persistPrediction({
        design:designAtStart,
        designId:designIdAtStart,
        modelVersion:'V3-Hourly-v1',
        kind:'hourly',
        result,
        diagnostics:result.diagnostics||{},
        weatherProfile:weather,
      });
    }catch(error){
      if(operationId!==hourlyRunId.current) return;
      setHourlyPredictionError('Unable to generate the 24-hour indoor-temperature prediction.');
      setHourlyPredictionErrorDetail(error?.message||'Weather or hourly model request failed.');
      setHourlyPrediction(null);
    }finally{
      if(operationId===hourlyRunId.current){
        setHourlyPredictionLoading(false);
        setHourlyProgress(null);
      }
    }
  };
  const openHourlySimulation=(design=s)=>{
    const selectedDesign=design?.geometry&&Array.isArray(design.layers)?design:s;
    setPage('simulate');
    void runHourlyPrediction(selectedDesign);
  };
  const nav = [
    ['overview', 'Overview'],
    ['climate', 'Climate'],
    ['materials', 'Materials'],
    ['design', 'Design a Shelter'],
  ];
  return <div className="app">
    <header className="topbar"><button className="brand" onClick={()=>setPage('overview')}>THERMO<span>SHELTER</span><small>CLIMATE-RESPONSIVE SHELTER DESIGN</small></button>
      {page!=='overview'&&<nav ref={navRef} aria-label="Main navigation">{nav.map(([id,label])=>{
        const active=page===id||(id==='design'&&page==='design');
        return <button key={id} className={active?'active':''} aria-current={active?'page':undefined} onClick={()=>id==='design'?openDesignWorkspace():setPage(id)}>{label}</button>;
      })}</nav>}
    </header>
    {toast&&<div className="toast">✓ {toast}</div>}
    {materialStatus.loading&&<div className="app-background-progress"><OperationProgress progress={materialProgress}/></div>}
    {storageNotice&&<div className="persistence-notice" role="status" aria-live="polite">{storageNotice}</div>}
    {page==='overview'&&<Overview onDesign={openDesignWorkspace} onClimate={()=>setPage('climate')} onMaterials={()=>setPage('materials')}/>}
    {page==='design'&&
  <Design
    s={s}
    materials={materials}
    materialStatus={materialStatus}
    update={update}
    updateG={updateG}
    onRun={runV3Prediction}
    onOpenHourlySimulation={openHourlySimulation}
    predictionLoading={v3PredictionLoading}
    predictionProgress={v3PredictionProgress}
    prediction={v3Prediction}
    predictionError={v3PredictionError}
    diagnostics={v3Diagnostics}
    savedDesigns={savedDesigns}
    savedDesignsLoading={savedDesignsLoading}
    savedDesignError={savedDesignError}
    savedDesignName={savedDesignName}
    onSavedDesignNameChange={setSavedDesignName}
    onSaveDesign={saveCurrentDesign}
    onLoadSavedDesign={loadSavedDesign}
    onRefreshSavedDesigns={refreshSavedDesignList}
    saveDesignLoading={saveDesignLoading}
    designProgress={designProgress}
    savedDesignId={savedDesignId}
    onBackToOverview={()=>setPage('overview')}
    onContinueToCompare={()=>setPage('compare')}
  />
}
    {page==='climate'&&<ClimatePage onBack={()=>setPage('overview')}/>}
    {page==='materials'&&<MaterialsPage materials={materials} materialStatus={materialStatus} onBack={()=>setPage('overview')}/>}
    {page==='simulate'&&<Simulation
      s={s}
      materials={materials}
      prediction={hourlyPrediction}
      loading={hourlyPredictionLoading}
      progress={hourlyProgress}
      error={hourlyPredictionError}
      errorDetail={hourlyPredictionErrorDetail}
      weatherProfile={hourlyWeatherProfile}
      requestPayload={hourlyRequestPayload}
      onRun={()=>runHourlyPrediction(s)}
      onGoDesign={openDesignWorkspace}
      onBackToOptimize={()=>setPage('optimize')}
      onContinueToReport={()=>setPage('report')}
    />}
    {page==='compare'&&<Compare
      s={s}
      evaluation={candidateEvaluation}
      progress={candidateProgress}
      onEvaluate={runCandidateEvaluation}
      onApplyCandidate={applyCandidate}
      onBackToDesign={()=>setPage('design')}
      onContinue={()=>setPage('optimize')}
    />}
    {page==='optimize'&&<Optimize
      s={s}
      evaluation={optimizationEvaluation}
      progress={optimizationProgress}
      onEvaluate={runOptimizationSearch}
      onApplyCandidate={applyOptimizationCandidate}
      onOpenHourlySimulation={openHourlySimulation}
      setPage={setPage}
      onBackToCompare={()=>setPage('compare')}
      onContinueToSimulation={()=>setPage('simulate')}
    />}
    {page==='report'&&(
      <Report s={s} materials={materials} prediction={v3Prediction} caseWeatherProfile={v3CaseWeatherProfile} predictionError={v3PredictionError} diagnostics={v3Diagnostics} candidateEvaluation={optimizationEvaluation.status==='idle'?candidateEvaluation:optimizationEvaluation} designHistory={savedDesignId?designHistory:null} onGoDesign={openDesignWorkspace} onBackToSimulation={()=>setPage('simulate')}/>
    )}
    <footer>THERMOSHELTER · CLIMATE-RESPONSIVE DESIGN DECISION SUPPORT . CREATED BY TEAM BYTE MEX </footer>
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

function PageBackLink({label,onClick}) {
  return <button className="view-back-link" type="button" onClick={onClick}>← {label}</button>;
}

function WorkflowActions({backLabel,onBack,nextLabel,onNext}) {
  return <div className="workflow-actions">
    {backLabel&&onBack&&<button className="ghost" type="button" onClick={onBack}>← {backLabel}</button>}
    {nextLabel&&onNext&&<button className="primary" type="button" onClick={onNext}>{nextLabel} →</button>}
  </div>;
}

function Overview({onDesign,onClimate,onMaterials}) {
  return (
    <main className="section overview-page redesigned-overview">
      <section className="studio-hero">
        <div className="studio-hero-copy">
          <div className="eyebrow">AREA-SPECIFIC THERMAL DESIGN</div>
          <h1>Design a HOME not just a shelter.</h1>
          <p className="lede">Set the local reference conditions, shape, openings and material layers. Review case-level thermal estimates and forecast-driven indoor temperatures with their scope and units.</p>
          <div className="studio-hero-actions">
            <button className="primary" type="button" onClick={onDesign}>Plan Shelter <span aria-hidden="true">→</span></button>
            <button className="text-action" type="button" onClick={onClimate}>Explore climate profiles</button>
            <button className="text-action" type="button" onClick={onMaterials}>Browse materials</button>
          </div>
          <div className="studio-facts" aria-label="Model output scope">
            <div><strong>21</strong><span>shelter and climate inputs</span></div>
            <div><strong>6</strong><span>case-level summary outputs</span></div>
            <div><strong>24</strong><span>hourly indoor temperatures</span></div>
          </div>
        </div>
        <div className="studio-geometry-card">
          <div className="studio-geometry-heading"><span>GEOMETRY PREVIEW</span><span></span></div>
          <Shelter3D />
          <div className="studio-geometry-caption"><strong>Shelter form</strong><span>Shape and dimensions only · no thermal field</span></div>
        </div>
      </section>
      <section className="studio-reference-strip">
        <div><span>REFERENCE CONDITIONS</span><strong>Six reference profiles + Bengaluru forecast</strong><p>Bengaluru case summaries and hourly runs use the next complete local-day forecast; other case summaries use fixed reference inputs.</p></div>
        <div className="studio-reference-note"><span>RESULT SCOPE</span><strong>Case-level rates and modeled-duration energy</strong><p>The hourly model returns indoor temperatures; it does not produce hourly heat-flow values.</p></div>
      </section>
    </main>
  );
}
function Design({s,materials,materialStatus,update,updateG,onRun,onOpenHourlySimulation,predictionLoading,predictionProgress,prediction,predictionError,diagnostics,savedDesigns,savedDesignsLoading,savedDesignError,savedDesignName,onSavedDesignNameChange,onSaveDesign,onLoadSavedDesign,onRefreshSavedDesigns,saveDesignLoading,designProgress,savedDesignId,onBackToOverview,onContinueToCompare}) {
  const totalWallThickness=(s.layerThicknesses?.reduce((sum,value)=>sum+value,0)
    ??s.layers.reduce((sum,id)=>sum+(materials[id]?.t||0),0));
  const [wallThicknessDraft,setWallThicknessDraft]=useState(totalWallThickness.toFixed(3));
  useEffect(()=>setWallThicknessDraft(totalWallThickness.toFixed(3)),[totalWallThickness]);

  const commitWallThickness=()=>{
    const requested=Number(wallThicknessDraft);
    if(Number.isFinite(requested)&&requested>0){
      try{
        update({layerThicknesses:scaleV3WallThickness(s,materials,requested)});
        return;
      }catch{
        // Restore the current displayed total for an invalid layer assembly.
      }
    }
    setWallThicknessDraft(totalWallThickness.toFixed(3));
  };

  return (
    <main className="section">

      <PageBackLink label="Back to Overview" onClick={onBackToOverview}/>
      <div className="eyebrow">DESIGN WORKSPACE</div>

      <div className="design-heading">
        <div>
          <h1>Describe your shelter.</h1>

          <p className="lede">
            Configure the shelter and request case-level thermal estimates. The 3D view
            below shows geometry only; use the separate hourly model for a
            forecast-driven indoor-temperature curve.
          </p>
        </div>

      </div>

      <section className="panel saved-design-panel" aria-labelledby="saved-design-heading">
        <div className="saved-design-copy">
          <div className="eyebrow">PROJECT PERSISTENCE</div>
          <h2 id="saved-design-heading">Save or load a design.</h2>
          <p>Saved inputs restore geometry, openings, orientation, climate and material layers. Predictions are stored separately as historical results.</p>
        </div>
        <div className="saved-design-actions">
          <label>
            Design name
            <input value={savedDesignName} maxLength={120} onChange={event=>onSavedDesignNameChange(event.target.value)} />
          </label>

          <button className="primary" onClick={onSaveDesign} disabled={saveDesignLoading}>
            {saveDesignLoading?'Saving design…':'Save Design'}
          </button>
          <label>
            Saved designs
            <select value="" onChange={event=>onLoadSavedDesign(event.target.value)} disabled={savedDesignsLoading||savedDesigns.length===0}>
              <option value="">{savedDesignsLoading?'Loading saved designs…':savedDesigns.length?'Choose a saved design':'No saved designs available'}</option>
              {savedDesigns.map(design=><option key={design.id} value={design.id}>{design.name||'Untitled shelter'}</option>)}
            </select>
          </label>
          <button className="ghost" onClick={onRefreshSavedDesigns} disabled={savedDesignsLoading}>
            {savedDesignsLoading?'Refreshing…':'Refresh list'}
          </button>
          <OperationProgress progress={designProgress}/>
        </div>
        <div className="saved-design-status" role="status" aria-live="polite">
          {savedDesignId&&<span>Current design is linked to a saved record.</span>}
          {materialStatus.loading&&<span>Loading the material catalog…</span>}
          {!materialStatus.loading&&materialStatus.warning&&<span>Material catalog: {materialStatus.warning}</span>}
          {savedDesignError&&<span className="persistence-error">Saved designs: {savedDesignError}</span>}
        </div>
      </section>

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

          {usesForecastBackedClimate(s.location)&&<p className="form-field-note">
            Case summary and hourly inputs use the next complete local-day forecast for this location. The model inputs are shown with the returned prediction.
          </p>}

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

          <p className="form-field-note">
            The summary model currently uses this target as its initial-air-temperature input; it has no separate initial-temperature control.
          </p>

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
                  ],
                  layerThicknesses:null,
                })
              }
            >
              {Object.keys(materials)
                .filter(k=>k!=='insulation')
                .map(k=>(
                  <option key={k} value={k}>
                    {materials[k].name}
                  </option>
                ))}
            </select>
          </label>

          <div className="live-input-note">
            The summary model combines the selected primary material with insulation and concrete into effective composite inputs. Total wall thickness is shared across those layers.
          </div>
          <label>
            Total wall thickness (m)
            <input
              id="total-wall-thickness"
              type="number"
              min="0.05"
              step="0.01"
              value={wallThicknessDraft}
              onChange={event=>setWallThicknessDraft(event.target.value)}
              onBlur={commitWallThickness}
            />
          </label>
          <p className="form-field-note">
            Enter the full selected wall assembly thickness. Its existing layer proportions are scaled to this total; V3 training-range warnings remain visible when the value is outside 0.05–0.40 m.
          </p>
          <p className="form-field-note">
            Occupant count is sent as design context and saved; the current summary and hourly models do not use it as a model feature.
          </p>

          <button
            className="primary wide"
            onClick={onRun}
            disabled={predictionLoading}
          >
            {predictionLoading
              ? 'Requesting case estimate...'
              : 'Predict thermal performance →'}
          </button>
          <OperationProgress progress={predictionLoading?predictionProgress:null}/>

        </div>

        <Design3DSimulation
          s={s}
          materials={materials}
        />

      </div>

      <V3PredictionResults
        prediction={prediction}
        error={predictionError}
        diagnostics={diagnostics}
        onOpenHourlySimulation={onOpenHourlySimulation}
      />
      <WorkflowActions nextLabel="Continue to Compare" onNext={onContinueToCompare}/>

    </main>
  );
}

function V3PredictionResults({prediction,error,diagnostics,onOpenHourlySimulation}) {
  if(!prediction&&!error&&!diagnostics?.numericOutOfRange?.length) return null;

  const numericRangeDiagnostics=prediction ? diagnostics?.numericOutOfRange||[] : [];
  const backendDiagnosticWarnings=(prediction?.warnings||[])
    .filter(warning=>!warning.includes('outside the training range'));
  const hasModelDiagnostics=numericRangeDiagnostics.length>0||backendDiagnosticWarnings.length>0;

  const outputRows=v3OutputRows(prediction);

  return (
    <section className="v3-results-card" aria-live="polite">
      <div className="v3-results-heading">
        <div>
          <div className="eyebrow">THERMAL CASE SUMMARY</div>
          <p>
            The summary model returns six case-level estimates trained on physics-informed labels. Solar heat input is a rate (W),
            heat transfer is one case-level rate (W), and thermal energy loss is reported for the modeled duration.
            The separate hourly model predicts indoor temperature only; it does not produce hourly heat flow.
          </p>
        </div>
        {prediction&&<button className="ghost v3-hourly-link" onClick={onOpenHourlySimulation}>
          Run 24-hour model prediction
        </button>}
      </div>

      {error&&<div className="v3-api-error" role="alert">{error}</div>}

      {hasModelDiagnostics&&<div className="v3-model-diagnostics" role="status">
        <strong>Model diagnostics</strong>
        {numericRangeDiagnostics.length>0&&<>
          <p>Some inputs are outside the observed model training range. The model still generated a prediction; reliability may be lower for these conditions.</p>
          <ul>
            {numericRangeDiagnostics.map(({field,value,supportedRange})=>(
              <li key={field}><b>{field}</b> = {String(value)} (observed training range: {supportedRange})</li>
            ))}
          </ul>
        </>}
        {backendDiagnosticWarnings.length>0&&<ul>
          {backendDiagnosticWarnings.map((warning,index)=><li key={`${index}-${warning}`}>{warning}</li>)}
        </ul>}
      </div>}

      {prediction&&<>
        <div className="v3-prediction-grid">
          {outputRows.map(([label,key,unit])=>(
            <div className="v3-prediction-value" key={key}>
              <small>{label}</small>
              <strong>{Number(prediction.predictions[key]).toLocaleString(undefined,{maximumFractionDigits:2})} {unit}</strong>
            </div>
          ))}
        </div>

        <details className="v3-input-summary">
          <summary>View 21 model inputs and design context sent to the API</summary>
          <p className="v3-input-note">
            Initial_Air_Temperature_C currently uses the Design page’s Target indoor temperature control. There is no separate initial-air-temperature input yet.
          </p>
          <dl>
            {Object.entries(prediction.input_summary).map(([name,value])=>(
              <div key={name}>
                <dt>{name}</dt>
                <dd>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      </>}
    </section>
  );
}

function Design3DSimulation({s,materials}) {
  const g=s.geometry;

  return (
    <div className="design-simulation">

      <div className="simulation-header">

        <div>
          <span>GEOMETRY PREVIEW · NO THERMAL FIELD</span>

          <strong>
            {g.length} × {g.width} × {g.height} m
          </strong>
        </div>

      </div>


      <div className="design-canvas">

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

          <ambientLight intensity={1.4} />

          <directionalLight position={[6,8,6]} intensity={2.5} />

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

            <meshStandardMaterial color="#687482" roughness={0.72} metalness={0.05} />

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

            <meshStandardMaterial color="#9bdcff" />

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


          {/* Decorative sun; this preview does not calculate solar transfer. */}
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
            autoRotate
            autoRotateSpeed={0.35}
          />

          <Environment preset="city"/>

        </Canvas>


      </div>


      <p className="geometry-preview-note">
        Shape, dimensions, and openings only; compass orientation remains in the design inputs. This view does not show a calculated temperature or heat-flow field; case-level estimates appear below after you run the summary model.
      </p>


      <div className="design-model-footer">

        <span>MATERIAL</span>

        <strong>
          {s.layers.map((id)=>materials[id]?.name||id).join(' + ')}
          {' · '}{(s.layerThicknesses?.reduce((sum,value)=>sum+value,0)
            ??s.layers.reduce((sum,id)=>sum+(materials[id]?.t||0),0)).toFixed(3)}{' m wall'}
        </strong>

        <span className="model-update">GEOMETRY ONLY</span>

      </div>

    </div>
  );
}
function ClimatePage({onBack}) {
  return (
    <main className="section climate-page">

      <PageBackLink label="Back to Overview" onClick={onBack}/>
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
        {Object.entries(CLIMATE).map(([id, c]) => {
          if(c.forecastBacked) return <article className="climate-card climate-reference-card" key={id}>
            <span>{c.name}</span>
            <strong>Forecast-backed</strong>
            <p>Open-Meteo next complete local-day inputs for V3 summary and hourly predictions.</p>
            <small>{c.elevation} · {c.season}</small>
          </article>;
          const lower=c.mean-c.amp;
          const upper=c.mean+c.amp;
          const left=clamp(((lower+20)/60)*100,0,100);
          const width=clamp(((upper-lower)/60)*100,0,100-left);
          return <article className="climate-card climate-reference-card" key={id}>
            <span>{c.name}</span>
            <strong>{c.mean}°C</strong>
            <div className="climate-envelope" aria-label={`Reference envelope ${lower} to ${upper} degrees Celsius`}>
              <div className="climate-envelope-labels"><small>{lower}°</small><small>reference envelope</small><small>{upper}°C</small></div>
              <div className="climate-envelope-track"><i style={{left:`${left}%`,width:`${width}%`}}/></div>
            </div>
            <p>Peak solar {c.solar} W/m² · wind {c.wind} m/s</p>
            <small>{c.elevation} · {c.season} · relative humidity {c.humidity}%</small>
          </article>;
        })}
      </div>


      <div className="panel climate-profile climate-source-panel">
        <div className="eyebrow">REFERENCE DATA AND FORECASTS</div>
        <h3>Profiles distinguish fixed references from forecast inputs.</h3>
        <p>
          The six established climate profiles use fixed reference temperature, peak radiation,
          wind, humidity and elevation values for case-level summaries. Bengaluru uses the next
          complete local-day Open-Meteo forecast for both case-level and hourly model inputs.
        </p>
        <p>
          For case-summary inputs, outdoor temperature is derived from the profile's mean and daily swing at hour 0;
          the daily solar input is approximated from peak radiation and six equivalent full-sun hours for the six
          static profiles. Bengaluru's forecast summary uses the forecast day mean, radiation peak and integrated
          daily radiation values. These are model inputs, not a model-produced solar-energy result in Wh.
        </p>
        <p>
          Weather source: <a href={OPEN_METEO_ATTRIBUTION.url} target="_blank" rel="noreferrer">
            {OPEN_METEO_ATTRIBUTION.label}
          </a> ({OPEN_METEO_ATTRIBUTION.license}). The geometry preview is illustrative and is not used as weather input.
        </p>
      </div>

    </main>
  );
}

function MaterialsPage({materials,materialStatus,onBack}) {

  return (
    <main className="section materials-page">

      <PageBackLink label="Back to Overview" onClick={onBack}/>
      <div className="eyebrow">MATERIALS</div>

      <h1>Material library.</h1>

      <p className="lede">
        Compare the thermal properties used by the shelter model.
        Select materials based on conductivity, thermal mass and resistance.
      </p>

      <div className="material-library-header">

        <div>
          <strong>{Object.keys(materials).length}</strong>
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

        {Object.entries(materials).map(([id, m]) => {

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
                  {(m.category||id).toUpperCase()}
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
            These are the reference material properties supplied to the model input builder. They are not a substitute
            for project-specific verified material data; source notes are shown with each catalog item where available.
          </p>
        </div>

      </div>

    </main>
  );
}

function HourlyTemperatureChart({values,targetC,selectedHour,onSelectHour}) {
  const numericValues=values.map(value=>Number(value));
  const low=Math.min(...numericValues,targetC);
  const high=Math.max(...numericValues,targetC);
  const pad=Math.max((high-low)*0.16,1);
  const min=low-pad;
  const max=high+pad;
  const range=max-min||1;
  const points=numericValues.map((value,index)=>{
    const x=34+(index*652)/Math.max(numericValues.length-1,1);
    const y=204-((value-min)/range)*168;
    return `${x},${y}`;
  }).join(' ');
  const targetY=204-((targetC-min)/range)*168;
  return <section className="hourly-chart-panel" aria-labelledby="hourly-chart-title">
    <div className="hourly-chart-heading"><div><div className="eyebrow">24-HOUR INDOOR TEMPERATURE</div><h2 id="hourly-chart-title">Forecast response across the day.</h2></div><span>°C</span></div>
    <div className="hourly-chart-frame">
      <svg viewBox="0 0 720 250" preserveAspectRatio="none" role="img" aria-label="Hourly indoor-temperature predictions with target temperature reference">
        <title>Predicted indoor temperature by forecast hour</title>
        {[0,1,2,3].map(index=>{
          const y=36+index*56;
          const value=max-(index/3)*range;
          return <g key={index}><line x1="34" x2="686" y1={y} y2={y} className="hourly-chart-gridline"/><text x="27" y={y+4} textAnchor="end" className="hourly-chart-axis">{value.toFixed(0)}°</text></g>;
        })}
        <line x1="34" x2="686" y1={targetY} y2={targetY} className="hourly-chart-target"/>
        <polyline points={points} className="hourly-chart-line"/>
        {numericValues.map((value,index)=>{
          const x=34+(index*652)/Math.max(numericValues.length-1,1);
          const y=204-((value-min)/range)*168;
          return <circle key={index} cx={x} cy={y} r={index===selectedHour?6:3.2} className={index===selectedHour?'hourly-chart-point selected':'hourly-chart-point'} role="button" tabIndex="0" aria-label={`Select hour ${index}: ${value.toFixed(1)} degrees Celsius`} onClick={()=>onSelectHour(index)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelectHour(index);}}} />;
        })}
        {[0,6,12,18,23].map(index=>{
          const x=34+(index*652)/23;
          const label=index===23?'24:00':`${String(index).padStart(2,'0')}:00`;
          return <text key={index} x={x} y="236" textAnchor={index===0?'start':index===23?'end':'middle'} className="hourly-chart-axis">{label}</text>;
        })}
      </svg>
    </div>
    <div className="hourly-chart-legend"><span><i className="chart-legend-temperature"/>Predicted indoor temperature</span><span><i className="chart-legend-target"/>Target {targetC.toFixed(1)}°C</span><small>Select a point or use the hourly values below.</small></div>
  </section>;
}

function Simulation({s,materials,prediction,loading,progress,error,errorDetail,weatherProfile,requestPayload,onRun,onGoDesign,onBackToOptimize,onContinueToReport}) {
  const [hour,setHour]=useState(0);
  const predictedValues=prediction?.predicted_indoor_temperature_C;
  const forecastPoints=weatherProfile?.displayPoints;
  const ready=Array.isArray(predictedValues)&&predictedValues.length===24
    &&Array.isArray(forecastPoints)&&forecastPoints.length===24;
  const currentPoint=ready?forecastPoints[hour]:null;
  const temp=ready?selectHourlyIndoorTemperature(prediction,hour):null;

  if(!ready){
    return (
      <main className="section simulation-page">
        <PageBackLink label="Back to Optimize" onClick={onBackToOptimize}/>
        <div className="eyebrow">ENGINEERING SIMULATION · HOURLY TEMPERATURE</div>
        <div className="simulation-heading">
          <div>
            <h1>24-hour temperature prediction.</h1>
            <p className="lede">The selected location's next complete local-day forecast is sent with the current shelter design to the hourly model.</p>
          </div>
          <div className={'solver-status '+(loading?'live':'')}>
            <span className="status-dot"></span>
            {loading?'MODEL RUNNING':'MODEL READY'}
          </div>
        </div>
        <section className="panel hourly-prediction-state" aria-live="polite">
          <div className="eyebrow">HOURLY MODEL STATUS</div>
          <h2>{loading?'Requesting 24-hour temperature predictions...':error||'No hourly prediction is available for this design.'}</h2>
          {errorDetail&&<p className="hourly-error-detail">{errorDetail}</p>}
          {loading&&<p>Fetching the external hourly forecast, then requesting 24 indoor-temperature predictions.</p>}
          {loading&&<OperationProgress progress={progress}/>}
          <div className="hourly-state-actions">
            <button className="primary" onClick={onRun} disabled={loading}>
              {loading?'Requesting 24-hour temperature predictions...':'Retry prediction'}
            </button>
            <button className="ghost" onClick={onGoDesign}>Review design</button>
          </div>
          {weatherProfile&&<p className="hourly-source-line">
            Forecast received for {weatherProfile.location}, {weatherProfile.localDate} ({weatherProfile.timezone}).
          </p>}
        </section>
        <p className="hourly-attribution">
          Weather forecast by <a href={OPEN_METEO_ATTRIBUTION.url} target="_blank" rel="noreferrer">{OPEN_METEO_ATTRIBUTION.label}</a>
          {' '}({OPEN_METEO_ATTRIBUTION.license}). The hourly view does not fall back to a locally generated forecast.
        </p>
        <WorkflowActions nextLabel="Continue to Report" onNext={onContinueToReport}/>
      </main>
    );
  }

  const outdoor=currentPoint.Outdoor_Temperature_C;
  const solar=currentPoint.Solar_Radiation_W_m2;
  const wind=currentPoint.Wind_Speed_m_s;
  const localClock=currentPoint.localTime.slice(11,16);
  const targetDifference=temp-s.target;
  const targetDifferenceLabel=`${targetDifference>=0?'+':''}${targetDifference.toFixed(1)}°C from target`;
  const tempPct=clamp(((temp+5)/30)*100,8,92);
  const targetPct=clamp(((s.target+5)/30)*100,8,92);
  const outOfRange=prediction?.diagnostics?.out_of_observed_range||[];

  return (
    <main className="section simulation-page">
      <PageBackLink label="Back to Optimize" onClick={onBackToOptimize}/>
      <div className="eyebrow">ENGINEERING SIMULATION · HOURLY TEMPERATURE</div>
      <div className="simulation-heading">
        <div>
          <h1>Watch the predicted indoor temperature.</h1>
          <p className="lede">A 24-hour indoor-temperature curve from the hourly model, using the selected location's external weather forecast and current shelter design. The scene below is illustrative only; no spatial temperature or heat-flow field is calculated.</p>
        </div>
        <div className="simulation-heading-actions">
          <div className={'solver-status '+(loading?'live':'')}>
            <span className="status-dot"></span>
            {loading?'MODEL RUNNING':'24-HOUR PREDICTION READY'}
          </div>
          <button className="ghost" onClick={onRun} disabled={loading}>
            {loading?'Requesting 24-hour temperature predictions...':'Refresh forecast and prediction'}
          </button>
        </div>
      </div>

      {error&&<div className="hourly-api-error" role="alert">
        <strong>{error}</strong>{errorDetail&&<small>{errorDetail}</small>}
      </div>}

      <section className="thermal-console">
        <div className="console-top">
          <div>
            <span className="console-label">HOURLY INDOOR-TEMPERATURE MODEL</span>
            <strong>INDOOR TEMPERATURE / 24H</strong>
          </div>
          <div className="console-meta">
            <span>{weatherProfile.location.toUpperCase()}</span>
            <span>{weatherProfile.localDate}</span>
            <span>STEP {String(hour+1).padStart(2,'0')}/24</span>
          </div>
        </div>

        <p className="hourly-scene-note">
          The selected-hour indoor temperature and forecast values are model/API outputs. The shelter scene is a static illustration and does not visualize heat transfer.
        </p>

        <div className="thermal-stage">
          <div className="environment-readout left-readout">
            <small>OUTDOOR FORECAST</small>
            <strong>{outdoor.toFixed(1)}°C</strong>
            <span>{localClock} · Open-Meteo</span>
          </div>

          <div className="thermal-scene">
            <div className="sun-orb">
              <div className="sun-core"></div>
              <div className="sun-rays"></div>
            </div>
            <div className="cold-field"></div>
            <div className="warm-field"></div>
            <div className="thermal-shelter">
              <div className="thermal-roof">
                <span className="layer-tag stone-tag">{materials[s.layers[0]]?.name||'WALL'}</span>
                <span className="layer-tag insulation-tag">THERMAL ENVELOPE</span>
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
              <div className="thermal-interior">
                <div className="window-glow"></div>
                <div className="inside-temp" data-testid="hourly-indoor-temperature">
                  <small>MODEL PREDICTION</small>
                  <strong>{temp.toFixed(1)}°C</strong>
                  <span>{targetDifferenceLabel}</span>
                </div>
              </div>
              <div className="thermal-floor"></div>
            </div>

          </div>

          <div className="environment-readout right-readout">
            <small>INDOOR PREDICTION</small>
            <strong>{temp.toFixed(1)}°C</strong>
            <span>Target {s.target.toFixed(1)}°C</span>
          </div>
        </div>

        <div className="simulation-timeline">
          <div className="timeline-labels">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
          </div>
          <input
            className="thermal-slider"
            type="range"
            min="0"
            max="23"
            value={hour}
            aria-label="Select prediction hour"
            data-testid="hourly-slider"
            onChange={e=>setHour(Number(e.target.value))}
          />
          <div className="timeline-current" data-testid="hourly-selected-hour">
            <span>FORECAST HOUR {String(hour).padStart(2,'0')}</span>
            <strong>{localClock}</strong>
          </div>
        </div>
      </section>

      <HourlyTemperatureChart values={predictedValues} targetC={s.target} selectedHour={hour} onSelectHour={setHour}/>

      <section className="hourly-temperature-series" aria-labelledby="hourly-temperature-title">
        <div className="eyebrow">24-HOUR MODEL OUTPUTS</div>
        <h2 id="hourly-temperature-title">Indoor temperature by hour.</h2>
        <p>All 24 values below come from the hourly model. Select an hour to inspect its forecast inputs; no hourly heat-flow values are produced.</p>
        <div className="hourly-temperature-grid">
          {predictedValues.map((value,index)=>{
            const forecastTime=forecastPoints[index]?.localTime;
            const time=forecastTime?forecastTime.slice(11,16):`${String(index).padStart(2,'0')}:00`;
            return <button
              className="hourly-temperature-item"
              key={index}
              type="button"
              data-testid={`hourly-temperature-${index}`}
              aria-label={`Hour ${index}, ${time}: predicted indoor temperature ${value.toFixed(2)} degrees Celsius`}
              aria-pressed={hour===index}
              onClick={()=>setHour(index)}
            >
              <span>HOUR {String(index).padStart(2,'0')} · {time}</span>
              <strong>{value.toFixed(1)}°C</strong>
            </button>;
          })}
        </div>
      </section>

      <section className="simulation-metrics">
        <div className="sim-metric">
          <span>PREDICTED INDOOR TEMPERATURE</span>
          <strong>{temp.toFixed(1)}°C</strong>
          <small>Hour {hour} · hourly model</small>
        </div>
        <div className="sim-metric">
          <span>OUTDOOR TEMPERATURE</span>
          <strong>{outdoor.toFixed(1)}°C</strong>
          <small>Open-Meteo forecast input</small>
        </div>
        <div className="sim-metric">
          <span>SOLAR RADIATION</span>
          <strong>{solar.toFixed(0)} W/m²</strong>
          <small>Open-Meteo hourly forecast input</small>
        </div>
        <div className="sim-metric">
          <span>WIND SPEED</span>
          <strong>{wind.toFixed(1)} m/s</strong>
          <small>Open-Meteo hourly forecast input</small>
        </div>
      </section>

      <section className="simulation-lower">
        <div className="panel thermal-gauge-panel">
          <div className="eyebrow">PREDICTED TEMPERATURE</div>
          <h2>Indoor temperature</h2>
          <div className="temperature-gauge">
            <div className="gauge-scale">
              <span>30°C</span><span>25°C</span><span>20°C</span><span>15°C</span><span>10°C</span><span>5°C</span>
            </div>
            <div className="gauge-track">
              <div className="target-marker" style={{bottom:String(targetPct)+'%'}}><span>TARGET</span></div>
              <div className="temperature-marker" style={{bottom:String(tempPct)+'%'}}><span>{temp.toFixed(1)}°</span></div>
            </div>
          </div>
          <div className="gauge-footer">
            <span>Outdoor {outdoor.toFixed(1)}°C</span>
            <strong>{targetDifferenceLabel}</strong>
            <span>Target {s.target.toFixed(1)}°C</span>
          </div>
        </div>

        <div className="panel energy-panel hourly-weather-panel">
          <div className="eyebrow">HOURLY WEATHER INPUTS</div>
          <h2>Conditions at {localClock}.</h2>
          <div className="hourly-weather-readouts">
            <div><small>OUTDOOR</small><strong>{outdoor.toFixed(1)}°C</strong></div>
            <div><small>SOLAR</small><strong>{solar.toFixed(0)} W/m²</strong></div>
            <div><small>WIND</small><strong>{wind.toFixed(1)} m/s</strong></div>
          </div>
          <p className="hourly-no-heat-flow">
            The hourly model returns indoor temperature only. No hourly heat loss, solar heat input or heat-transfer rate is inferred here.
          </p>
        </div>
      </section>

      <section className="simulation-bottom">
        <div className="panel">
          <div className="eyebrow">FORECAST AND MODEL</div>
          <div className="status-grid">
            <div><small>LOCATION</small><strong>{weatherProfile.location}</strong></div>
            <div><small>LOCAL FORECAST DAY</small><strong>{weatherProfile.localDate}</strong></div>
            <div><small>HOURLY WEATHER SOURCE</small><strong>{weatherProfile.source}</strong></div>
            <div><small>INDOOR TEMPERATURE MODEL</small><strong>{prediction.model_version}</strong></div>
          </div>
        </div>
        <div className="panel simulation-explanation">
          <div className="eyebrow">MODEL INTERPRETATION</div>
          <h3>Hour {hour}: {targetDifferenceLabel}.</h3>
          <p>
            At {localClock}, the hourly model predicts {temp.toFixed(2)}°C indoors from the current shelter inputs and hourly forecast. It does not predict heat-flow quantities.
          </p>
        </div>
      </section>

      {outOfRange.length>0&&<section className="hourly-diagnostics" role="status">
        <strong>Model diagnostics</strong>
        <p>{prediction.diagnostics?.message||'Some inputs are outside the observed hourly model training range. Prediction was generated; reliability may be lower.'}</p>
        <ul>{outOfRange.map((item,index)=>(
          <li key={item.field+'-'+index}>
            <b>{item.field}</b> outside [{item.observed_range.join(', ')}]
            {Array.isArray(item.hours)
              ? ' at hours '+item.hours.join(', ')
              : ' · value '+String(item.value)}
          </li>
        ))}</ul>
      </section>}

      {requestPayload&&<details className="hourly-input-disclosure">
        <summary>View 21 model inputs, design context, and 24 hourly weather points sent to the hourly API</summary>
        <p>
          The static solar input is the forecast daily peak; daily solar energy is integrated from the 24 hourly radiation values. Temperature, wind and relative humidity case inputs are day means.
        </p>
        <h3>21 model inputs and design context</h3>
        <dl className="hourly-case-inputs">
          {Object.entries(requestPayload.case_inputs).map(([name,value])=>(
            <div key={name}><dt>{name}</dt><dd>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}</dd></div>
          ))}
        </dl>
        <h3>24 hourly weather inputs</h3>
        <div className="table-wrap hourly-profile-table-wrap">
          <table className="hourly-profile-table">
            <thead><tr><th>Model hour</th><th>Local time</th><th>Outdoor °C</th><th>Solar W/m²</th><th>Wind m/s</th></tr></thead>
            <tbody>{requestPayload.hourly_climate.map((point,index)=>(
              <tr key={point.Hour} className={point.Hour===hour?'hourly-selected-row':''}>
                <td>{point.Hour}</td>
                <td>{weatherProfile.displayPoints[index].localTime}</td>
                <td>{point.Outdoor_Temperature_C}</td>
                <td>{point.Solar_Radiation_W_m2}</td>
                <td>{point.Wind_Speed_m_s}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="hourly-attribution">
          Forecast by <a href={weatherProfile.sourceUrl} target="_blank" rel="noreferrer">{weatherProfile.source}</a> ·
          {' '}{weatherProfile.location} ({weatherProfile.latitude}, {weatherProfile.longitude}) ·
          {' '}{weatherProfile.localDate} · {weatherProfile.timezone} · {weatherProfile.license}.
        </p>
      </details>}

      <p className="hourly-attribution">
        Weather forecast by <a href={weatherProfile.sourceUrl} target="_blank" rel="noreferrer">{OPEN_METEO_ATTRIBUTION.label}</a>
        {' '}({OPEN_METEO_ATTRIBUTION.license}) for {weatherProfile.location}. It is forecast data, not a local observation.
        The Simulation displays hourly indoor temperature predictions only.
      </p>
      <WorkflowActions nextLabel="Continue to Report" onNext={onContinueToReport}/>
    </main>
  );
}
function Kpi({label,value}){return <div className="kpi"><small>{label}</small><strong>{value}</strong></div>}

function V3CandidateDiagnostics({candidate}) {
  const outOfRange = candidate.diagnostics?.numericOutOfRange || [];
  const extraWarnings = (candidate.prediction?.warnings || [])
    .filter((warning) => !warning.includes('outside the training range'));
  if (!outOfRange.length && !extraWarnings.length) return null;

  return (
    <div className="candidate-model-diagnostics">
      {outOfRange.length > 0 && (
        <span>
          Model diagnostics — outside the observed training range: {outOfRange
            .map(({field,value,supportedRange})=>field+'='+value+' ('+supportedRange+')')
            .join('; ')}. Prediction was generated; reliability may be lower for these conditions.
        </span>
      )}
      {extraWarnings.map((warning,index)=><span key={index+'-'+warning}>{warning}</span>)}
    </div>
  );
}

function V3CandidateResultsTable({rows,targetTemperatureC,onApplyCandidate}) {
  const ranked = rankV3CandidatesByTarget(rows,targetTemperatureC);
  const rankedIds = new Set(ranked.map((candidate)=>candidate.id));
  const displayRows = [...ranked,...rows.filter((candidate)=>!rankedIds.has(candidate.id))];
  const formatValue = (candidate,key) => {
    const value = candidate.prediction?.predictions?.[key];
    return typeof value==='number'&&Number.isFinite(value)
      ? value.toLocaleString(undefined,{maximumFractionDigits:2})
      : '—';
  };

  if(!displayRows.length) return null;

  return (
    <div className="table-wrap compare-table v3-candidate-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Candidate configuration</th>
            <th>Average indoor</th>
            <th>Target indoor</th>
            <th>Absolute target gap</th>
            <th>Minimum indoor</th>
            <th>Maximum indoor</th>
            <th>Solar heat input rate (W)</th>
            <th>Case heat transfer rate (W)</th>
            <th>Thermal energy loss (Wh / 24 h case)</th>
            <th>Design</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((candidate,index)=>{
            const prediction=candidate.prediction;
            const rankedIndex=ranked.findIndex((item)=>item.id===candidate.id);
            const average=prediction?.predictions?.Average_Air_Temperature_C;
            const targetGap=typeof average==='number'?Math.abs(average-targetTemperatureC):null;
            return (
              <tr className={rankedIndex===0?'recommended':''} key={candidate.id}>
                <td><span className="compare-rank">{rankedIndex>=0?'#'+(rankedIndex+1):'—'}</span></td>
                <td>
                  <b>{candidate.label}</b>
                  {rankedIndex===0&&<span className="pill">CLOSEST AVG TO TARGET</span>}
                  {candidate.error&&<small className="candidate-request-error">{candidate.error}</small>}
                  <V3CandidateDiagnostics candidate={candidate}/>
                </td>
                <td>{formatValue(candidate,'Average_Air_Temperature_C')} {prediction?'°C':''}</td>
                <td>{targetTemperatureC.toFixed(1)}°C</td>
                <td>{targetGap===null?'—':targetGap.toFixed(2)+'°C'}</td>
                <td>{formatValue(candidate,'Minimum_Air_Temperature_C')} {prediction?'°C':''}</td>
                <td>{formatValue(candidate,'Maximum_Air_Temperature_C')} {prediction?'°C':''}</td>
                <td>{formatValue(candidate,'Solar_Heat_Input_W')} {prediction?'W':''}</td>
                <td>{formatValue(candidate,'Heat_Transfer_Rate_W')} {prediction?'W':''}</td>
                <td>{formatValue(candidate,'Thermal_Energy_Loss_Wh')} {prediction?'Wh':''}</td>
                <td><button className="ghost candidate-apply-button" onClick={()=>onApplyCandidate(candidate)}>Use</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="candidate-output-note">
        Solar heat input and heat transfer are rates in W. Thermal energy loss is the aggregate for each 24-hour candidate case (Wh); these columns are not hourly flow values.
      </p>
    </div>
  );
}

function CandidateEvaluationFeedback({evaluation,progress}) {
  if(evaluation.status==='loading') return (
    <div className="v3-candidate-loading">
      <OperationProgress progress={progress}/>
    </div>
  );
  if(!evaluation.errors?.length) return null;
  const visibleErrors=evaluation.errors.slice(0,5);

  return (
    <div className="v3-candidate-errors" role="alert">
      <strong>{evaluation.status==='partial'?'Some candidate requests failed.':'Candidate evaluation failed.'}</strong>
      <ul>
        {visibleErrors.map(({candidate,message},index)=>(
          <li key={candidate+'-'+index}><b>{candidate}:</b> {message}</li>
        ))}
      </ul>
      {evaluation.errors.length>visibleErrors.length&&<small>
        {evaluation.errors.length-visibleErrors.length} additional candidate requests failed.
      </small>}
    </div>
  );
}

function Compare({s,evaluation,progress,onEvaluate,onApplyCandidate,onBackToDesign,onContinue}) {
  const ranked=rankV3CandidatesByTarget(evaluation.rows,s.target);
  const closest=ranked[0];
  const isLoading=evaluation.status==='loading';

  return (
    <main className="section compare-page">
      <PageBackLink label="Back to Design" onClick={onBackToDesign}/>
      <div className="eyebrow">COMPARE</div>
      <div className="compare-title-row">
        <div>
          <h1>Compare configurations.</h1>
          <p className="lede">
            The summary model evaluates each existing material assembly with the same climate, geometry,
            openings, orientation, target, duration and timestep.
          </p>
        </div>
        <button className="primary" onClick={onEvaluate} disabled={isLoading}>
          {isLoading?'Evaluating candidates…':'Evaluate materials'}
        </button>
      </div>

      <CandidateEvaluationFeedback evaluation={evaluation} progress={progress}/>

      {ranked.length>0&&<>
        <div className="compare-summary">
          <div className="compare-summary-card">
            <small>CLOSEST AVG TEMPERATURE TO TARGET</small>
            <strong>{closest.label}</strong>
            <span>Absolute gap: {closest.targetDeviationC.toFixed(2)}°C</span>
          </div>
          <div className="compare-summary-card">
            <small>USER TARGET INDOOR TEMPERATURE</small>
            <strong>{s.target.toFixed(1)}°C</strong>
            <span>Shared target for every candidate</span>
          </div>
          <div className="compare-summary-card">
            <small>MODEL PREDICTIONS RETURNED</small>
            <strong>{ranked.length} / {evaluation.rows.length}</strong>
            <span>Six summary outputs per successful candidate</span>
          </div>
        </div>

        <V3CandidateResultsTable
          rows={evaluation.rows}
          targetTemperatureC={s.target}
          onApplyCandidate={onApplyCandidate}
        />

        <div className="compare-explanation">
          <div>
            <div className="eyebrow">COMPARISON METRIC</div>
            <h2>{closest.label} is closest to the target on predicted average indoor temperature.</h2>
            <p>
              Candidates are ordered by |predicted average indoor temperature − target indoor
              temperature|. This describes closeness among the evaluated options; it does not rank
              solar input, heat transfer rate, or thermal energy loss as inherently better or worse.
            </p>
          </div>
          <div className="compare-delta">
            <small>ABSOLUTE TARGET GAP</small>
            <strong>{closest.targetDeviationC.toFixed(2)}°C</strong>
            <span>lower means closer to the target</span>
          </div>
        </div>
      </>}

      {evaluation.status==='idle'&&<div className="note">
        Evaluate the current design's material assemblies with the case-summary model.
        It returns case-level summaries, not an hourly temperature curve.
      </div>}

      <div className="note v3-comparison-note">
        <b>Model diagnostics:</b> candidates outside observed numeric training ranges are still
        predicted and identified in their row. Extrapolation may reduce reliability.
      </div>
      <WorkflowActions nextLabel="Continue to Optimize" onNext={onContinue}/>
    </main>
  );
}

function Optimize({s,evaluation,progress,onEvaluate,onApplyCandidate,onOpenHourlySimulation,onBackToCompare,onContinueToSimulation}) {
  const ranked=rankV3CandidatesByTarget(evaluation.rows,s.target);
  const closest=ranked[0];
  const isLoading=evaluation.status==='loading';

  return (
    <main className="section optimize-page">
      <PageBackLink label="Back to Compare" onClick={onBackToCompare}/>
      <div className="eyebrow">OPTIMIZE</div>
      <div className="compare-title-row">
        <div>
          <h1>Screen the design space.</h1>
          <p className="lede">
            Screen material, wall-thickness, shelter-size, orientation, window, and door combinations
            through the case-summary model. The balanced screen targets 36 cases; climate and target stay fixed.
          </p>
        </div>
        <button className="primary" onClick={onEvaluate} disabled={isLoading}>
          {isLoading?'Screening candidates…':'Evaluate candidates'}
        </button>
      </div>

      <CandidateEvaluationFeedback evaluation={evaluation} progress={progress}/>

      <div className={`optimization-hero${closest?'':' empty'}`}>
        <div>
          <div className="eyebrow">CLOSEST TO TARGET IN THIS SCREENED SET</div>
          {closest?<>
            <h2>{closest.searchFactors?.material
              ? `${closest.searchFactors.material} + Insulation + Concrete`
              : (closest.label?.split(' · ')[0]||closest.label)}</h2>
            <p>
              Predicted average indoor temperature: {closest.prediction.predictions.Average_Air_Temperature_C.toFixed(2)}°C.
              User target: {s.target.toFixed(1)}°C. Absolute gap: {closest.targetDeviationC.toFixed(2)}°C.
            </p>
            <div className="optimization-actions">
              <button className="primary" onClick={()=>onApplyCandidate(closest)}>Open this design →</button>
              <button className="ghost light" onClick={onOpenHourlySimulation}>Run 24-hour model prediction</button>
            </div>
          </>:<p>Run the search to compare model predictions across the bounded candidate set.</p>}
        </div>
        {closest&&<div className="optimization-score">
          <strong>{closest?closest.targetDeviationC.toFixed(2):'—'}</strong>
          <span>°C</span>
          <small>ABSOLUTE TARGET GAP</small>
        </div>}
      </div>

      {closest&&<div className="optimization-stats">
        <div><small>AVERAGE INDOOR</small><strong>{closest.prediction.predictions.Average_Air_Temperature_C.toFixed(2)}°C</strong></div>
        <div><small>TARGET INDOOR</small><strong>{s.target.toFixed(1)}°C</strong></div>
        <div><small>MIN / MAX INDOOR</small><strong>{closest.prediction.predictions.Minimum_Air_Temperature_C.toFixed(2)} / {closest.prediction.predictions.Maximum_Air_Temperature_C.toFixed(2)}°C</strong></div>
        <div><small>ENERGY LOSS · 24 H CASE</small><strong>{closest.prediction.predictions.Thermal_Energy_Loss_Wh.toLocaleString(undefined,{maximumFractionDigits:2})} Wh</strong></div>
      </div>}

      <div className="ranking optimization-ranking">
        <div className="ranking-header">
          <div>
            <div className="eyebrow">CANDIDATE SCREEN</div>
            <h2>Ranked by target-temperature gap.</h2>
          </div>
            <span>{ranked.length} predictions · {evaluation.rows.length} candidates</span>
        </div>
        {evaluation.rows.length>0&&<V3CandidateResultsTable
          rows={evaluation.rows}
          targetTemperatureC={s.target}
          onApplyCandidate={onApplyCandidate}
        />}
      </div>

      {closest&&<div className="optimization-insight">
        <div className="eyebrow">OPTIMIZATION METRIC</div>
        <h2>Lower average-temperature gap means closer to the target.</h2>
        <p>
          Ranking formula: |predicted average indoor temperature − target indoor temperature|, in °C.
          Other outputs remain visible for engineering comparison but are not weighted into this
          ranking. This identifies the closest option in the screened set; it is not a claim of
          objectively best engineering performance.
        </p>
      </div>}

      <div className="note optimization-search-method">
        <b>Search method:</b> six existing primary materials × three wall-thickness levels (Q1,
        median, Q3 from the existing training inputs), with up to two geometry/orientation profiles
        per material and thickness pair. The profile set uses the current geometry when it is within
        range, plus quartile profiles for shelter dimensions and openings; it covers the existing
        orientations across the search where the opening and wall-face checks permit. Wall thickness
        levels scale the current layer proportions. Climate and target inputs stay fixed.
        Candidates outside any recorded numeric or category range, plus openings larger than a
        wall face, are omitted. Ranking uses only |predicted average indoor temperature − target|; this is
        a bounded model screen, not a global or engineering optimum. Each row is a case-level summary
        estimate based on physics-informed labels; running this search does not start ANSYS for the
        candidate designs.
      </div>

      {evaluation.status==='idle'&&<div className="note">
        No predictions are calculated until you run this design-space search.
      </div>}
      <WorkflowActions nextLabel="Continue to Engineering Simulation" onNext={onContinueToSimulation}/>
    </main>
  );
}

function ModelDiagnostics({prediction,diagnostics}) {
  const outOfRange=diagnostics?.numericOutOfRange||[];
  const warnings=prediction?.warnings||[];
  if (!outOfRange.length&&!warnings.length) return null;

  return (
    <div className="v3-model-diagnostics" role="status">
      <strong>Model diagnostics</strong>
      {outOfRange.length>0&&<>
        <p>Some inputs are outside the observed V3 training range. A prediction was generated; reliability may be lower for those conditions.</p>
        <ul>{outOfRange.map(({field,value,supportedRange})=>(
          <li key={field}><b>{field}</b> = {String(value)} (observed range: {supportedRange})</li>
        ))}</ul>
      </>}
      {warnings.length>0&&<ul>{warnings.map((warning,index)=><li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
    </div>
  );
}

function Ansys({prediction,diagnostics,predictionError,onGoDesign}) {
  return (
    <main className="section engineering-page">
        <div className="eyebrow">ENGINEERING EVIDENCE</div>
      <h1>Engineering evidence.</h1>
      <p className="lede">
        THERMOSHELTER provides rapid web estimates through its V3 surrogate, trained on prepared physics-informed estimates reported as calibrated against three ANSYS Fluent cases. This page does not launch ANSYS or validate the current design inputs.
      </p>

      <section className="panel engineering-section">
        <div className="eyebrow">REPORTED MODEL-DEVELOPMENT CONTEXT</div>
        <h2>From engineering inputs to a rapid estimate</h2>
        <ol className="engineering-flow">
          {[
            'User-defined shelter, climate and material inputs',
            'Parameterized ANSYS thermal model',
            'High-fidelity thermal simulation',
            'Thermal outputs and prepared engineering dataset',
            'V3 surrogate model',
            'Rapid web prediction',
          ].map((step,index)=><li key={step}><span>{String(index+1).padStart(2,'0')}</span><b>{step}</b></li>)}
        </ol>
        <p className="engineering-footnote">This sequence describes the provenance reported for the prepared data; no attached ANSYS project or per-case mapping verifies these steps for each training row. The browser sends predictions to the existing FastAPI service and V3 model; it does not execute ANSYS.</p>
      </section>

      <section className="panel engineering-section">
        <div className="eyebrow">THERMOSHELTER V3 RAPID WEB PREDICTION</div>
        <h2>Case-level thermal summary</h2>
        <p className="engineering-copy">V3 estimates six case-level outputs from 21 input features. It does not return a 24-hour temperature curve; the separate hourly model predicts indoor temperature only.</p>
        {prediction
          ? <>
              <V3PredictionGrid prediction={prediction}/>
              <ModelDiagnostics prediction={prediction} diagnostics={diagnostics}/>
            </>
          : <div className="engineering-empty" role={predictionError?'alert':'status'}>
              {predictionError||'No V3 prediction is available for the current design yet. Run the V3 case estimate on the Design page to show its six outputs here.'}
              <button className="ghost" onClick={onGoDesign}>Open Design</button>
            </div>}
        <div className="engineering-model-strip">
          <div><small>MODEL VERSION</small><b>V3</b></div>
          <div><small>INPUT FEATURES</small><b>21</b></div>
          <div><small>OUTPUT PREDICTIONS</small><b>6 summary values</b></div>
        </div>
      </section>

      <section className="panel engineering-section">
        <div className="eyebrow">MODEL DATA NOTE</div>
        <p className="engineering-copy">The prepared V3 dataset contains physics-informed estimates calibrated against three ANSYS Fluent cases. The 6,500 training rows are not 6,500 independent ANSYS simulations or field validations.</p>
      </section>
    </main>
  );
}

function Report({s,materials,prediction,caseWeatherProfile,predictionError,diagnostics,candidateEvaluation,designHistory,onGoDesign,onBackToSimulation}) {
  const climate=CLIMATE[s.location]||CLIMATE.leh;
  const externalTemperature=prediction?.input_summary?.External_Temperature_C
    ?? (climate.forecastBacked?null:getDisplayedOutdoorTemperatureForClimate(climate));
  const materialConfiguration=s.layers.map((id)=>materials[id]?.name||id).join(' + ');
  const totalWallThickness=s.layerThicknesses?.reduce((sum,value)=>sum+value,0)
    ??s.layers.reduce((sum,id)=>sum+(materials[id]?.t||0),0);
  const closest=rankV3CandidatesByTarget(candidateEvaluation?.rows||[],s.target)[0];
  const historicalSummary=latestHistoricalSummary(designHistory);
  const historicalHourly=latestHistoricalHourly(designHistory);
  const historicalOptimization=(designHistory?.optimization_runs||[]).find((record)=>record?.selected_candidate);
  const historicalHourlyValues=historicalHourly?.prediction?.predicted_indoor_temperature_C||[];
  const historicalHourlyMin=historicalHourlyValues.length?Math.min(...historicalHourlyValues):null;
  const historicalHourlyMax=historicalHourlyValues.length?Math.max(...historicalHourlyValues):null;
  const average=prediction?.predictions?.Average_Air_Temperature_C;
  const targetGap=typeof average==='number'&&Number.isFinite(average)
    ? Math.abs(average-s.target)
    : null;

  return (
    <main className="section report-page">
      <PageBackLink label="Back to Engineering Simulation" onClick={onBackToSimulation}/>
      <div className="eyebrow">REPORT</div>
      <div className="report-page-heading">
        <div><h1>Thermal design assessment.</h1><p className="lede">Current design inputs, case-level estimates and saved historical results.</p></div>
        <button className="primary report-print-button" onClick={()=>window.print()}>Print / Save Report</button>
      </div>

      <article className="report-card report-document">
        <header className="report-title">
          <div><span>THERMOSHELTER</span><small>Thermal Design Assessment</small></div>
          <span className="report-version">CURRENT DESIGN CASE</span>
        </header>

        <section className="report-section">
          <div className="eyebrow">DESIGN INPUT SUMMARY</div>
          <div className="report-grid">
            <div><span>Location</span><b>{climate.name}</b></div>
            <div><span>V3 climate mode</span><b>{climate.forecastBacked?'Open-Meteo next-day forecast':'Static reference profile'}</b></div>
            <div><span>Shape representation</span><b>Rectangular cuboid</b></div>
            <div><span>V3 external temperature · {climate.forecastBacked?'forecast day mean':'reference profile'}</span><b>{typeof externalTemperature==='number'?`${externalTemperature.toFixed(1)}°C`:'Run a current prediction'}</b></div>
            {caseWeatherProfile?.localDate&&<div><span>Weather forecast date</span><b>{caseWeatherProfile.localDate}</b></div>}
            <div><span>Shelter length</span><b>{s.geometry.length} m</b></div>
            <div><span>Shelter width</span><b>{s.geometry.width} m</b></div>
            <div><span>Shelter height</span><b>{s.geometry.height} m</b></div>
            <div><span>Occupants · design context, not a model feature</span><b>{s.occupants}</b></div>
            <div><span>Window area</span><b>{s.geometry.windowArea} m²</b></div>
            <div><span>Door area</span><b>{s.geometry.doorArea} m²</b></div>
            <div><span>Orientation</span><b>{s.geometry.orientation}</b></div>
            <div><span>Target indoor temperature</span><b>{s.target.toFixed(1)}°C</b></div>
            <div className="report-grid-wide"><span>Material configuration</span><b>{materialConfiguration}</b></div>
            <div><span>Total wall assembly thickness</span><b>{totalWallThickness.toFixed(3)} m</b></div>
          </div>
        </section>

        <section className="report-section">
          <div className="eyebrow">CURRENT CASE-LEVEL PREDICTION</div>
          {prediction
            ? <>
                <p className="engineering-copy report-method-note">
                  V3 outputs are estimates from physics-informed labels; the project report documents calibration against three ANSYS Fluent cases, not field validation. Solar heat input is a rate in W, heat transfer is one case-level rate in W, and thermal energy loss covers the modeled duration shown below. No hourly heat-flow series is available.
                </p>
                <V3PredictionGrid prediction={prediction}/>
                <div className="report-target-comparison">
                  <div><small>TARGET INDOOR TEMPERATURE</small><strong>{s.target.toFixed(2)}°C</strong></div>
                  <div><small>V3 PREDICTED AVERAGE INDOOR</small><strong>{typeof average==='number'?`${average.toFixed(2)}°C`:'—'}</strong></div>
                  <div><small>ABSOLUTE TEMPERATURE GAP</small><strong>{targetGap===null?'—':`${targetGap.toFixed(2)}°C`}</strong></div>
                </div>
              </>
            : <div className="engineering-empty report-empty" role={predictionError?'alert':'status'}>
                {predictionError||'No V3 prediction is available for the current design. Run the V3 case estimate on the Design page before generating a results report.'}
                <button className="ghost" onClick={onGoDesign}>Open Design</button>
          </div>}
        </section>

        {historicalSummary&&<section className="report-section report-history-section">
          <div className="eyebrow">SAVED HISTORICAL V3 RESULT</div>
          <p className="engineering-copy">This is the latest stored summary prediction for the loaded design. It is historical and is not presented as a new calculation for the current session.</p>
          <div className="report-history-meta">Saved {historicalSummary.created_at?new Date(historicalSummary.created_at).toLocaleString():'time unavailable'} · {historicalSummary.model_version}</div>
          <V3PredictionGrid prediction={historicalSummary.prediction}/>
          <ModelDiagnostics prediction={historicalSummary.prediction} diagnostics={historicalSummary.diagnostics}/>
        </section>}

        {historicalHourly&&<section className="report-section report-history-section">
          <div className="eyebrow">SAVED HISTORICAL 24-HOUR RESULT</div>
          <p className="engineering-copy">Stored V3 Hourly Surrogate output for the loaded design. It remains historical and does not replace a current calculation.</p>
          <div className="report-history-meta">
            Saved {historicalHourly.created_at?new Date(historicalHourly.created_at).toLocaleString():'time unavailable'}
            {' · '}{historicalHourly.model_name||'V3 Hourly Surrogate'}
            {(historicalHourly.weather_profile?.localDate)&&` · Forecast ${historicalHourly.weather_profile.localDate}`}
          </div>
          {historicalHourlyMin!==null&&<p className="engineering-copy">
            Indoor temperature range: {historicalHourlyMin.toFixed(1)}–{historicalHourlyMax.toFixed(1)}°C.
          </p>}
          <div className="report-hourly-history" aria-label="Saved hourly indoor temperatures">
            {historicalHourlyValues.map((temperature,hour)=><span key={hour}>
              <small>{hour.toString().padStart(2,'0')}:00</small><b>{temperature.toFixed(1)}°C</b>
            </span>)}
          </div>
        </section>}

        {historicalOptimization&&<section className="report-section report-history-section">
          <div className="eyebrow">SAVED HISTORICAL OPTIMIZATION SEARCH</div>
          <p className="engineering-copy">Stored V3 surrogate search result for the loaded design; this does not represent a current run or an engineering optimum.</p>
          <div className="report-reco">
            <span>{historicalOptimization.candidate_count||0} CANDIDATES · V3 SCREEN</span>
            <b>{historicalOptimization.selected_candidate.label||'Selected candidate'}</b>
            {Number.isFinite(historicalOptimization.selected_candidate.target_deviation_C)&&<p>Absolute target gap: {historicalOptimization.selected_candidate.target_deviation_C.toFixed(2)}°C.</p>}
            <small>Saved {historicalOptimization.created_at?new Date(historicalOptimization.created_at).toLocaleString():'time unavailable'}</small>
          </div>
          {historicalOptimization.selected_candidate.prediction&&<V3PredictionGrid prediction={historicalOptimization.selected_candidate.prediction}/>}
        </section>}

        {prediction&&<section className="report-section">
          <div className="eyebrow">CANDIDATE EVALUATION</div>
          {closest
            ? <div className="report-reco">
                <span>CLOSEST WITHIN THE EVALUATED CANDIDATE SET</span>
                <b>{closest.label}</b>
                <p>V3 average indoor temperature is {closest.prediction.predictions.Average_Air_Temperature_C.toFixed(2)}°C, with an absolute target gap of {closest.targetDeviationC.toFixed(2)}°C. Candidates use the same target-gap metric as Compare and Optimize.</p>
              </div>
            : <p className="engineering-copy">No Compare or Optimize candidate evaluation has been run for these current inputs.</p>}
        </section>}

        {prediction&&<section className="report-section"><ModelDiagnostics prediction={prediction} diagnostics={diagnostics}/></section>}

        <section className="report-section report-provenance">
          <div className="eyebrow">DATA AND MODEL PROVENANCE</div>
          <p>The V3 model was trained using four full-feature datasets totaling 6,500 unique cases. The prepared datasets are labeled physics-informed estimates and were calibrated against three ANSYS Fluent cases. This does not mean all 6,500 cases were independently simulated in ANSYS. No field measurements were supplied in the verified V3 training report.</p>
        </section>
      </article>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App/>);

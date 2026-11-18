import React, { useState, useEffect, useRef, useContext } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, Animated, Modal,
  BackHandler, StatusBar, Platform, useWindowDimensions
} from 'react-native';
import { MaterialCommunityIcons as MI } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

/* Edit these values */
const APP_NAME = 'Calculator';
const COMPANY = 'Your Company';
const APP_VERSION = '1.0.1';
const AD_UNIT_ID = 'AdMob banner ID not configured';

const DARK = { bg:'#000', key:'#202022', tx:'#ececec', gr:'#8a8a90', ln:'#2a2a2e', card:'#1c1c1e', chip:'#2a2a2e', or:'#f0821a' };
const LIGHT = { bg:'#fff', key:'#ececef', tx:'#111', gr:'#6b6b72', ln:'#e2e2e6', card:'#f3f3f6', chip:'#e6e6ea', or:'#f0821a' };
const Theme = React.createContext(DARK);
const num = x => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const fmt = x => {
  if (!Number.isFinite(x)) return 'Error';
  if (Object.is(x, -0) || x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e15 || a < 1e-9) return x.toExponential(6).replace(/\.?0+e/, 'e');
  return Number(x.toPrecision(12)).toString();
};
const commas = s => String(s).replace(/^(-?)(\d+)(\.\d*)?$/, (_, sign, whole, dec='') =>
  sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + dec);
const pretty = s => String(s).replace(/asin/g,'sin⁻¹').replace(/acos/g,'cos⁻¹').replace(/atan/g,'tan⁻¹');

const TOKEN = /asin|acos|atan|sin|cos|tan|lg|ln|\d+\.?\d*|\.\d+|[πe√+−×÷^()%!]/g;
function evaluate(expression, radians=true) {
  const D = radians ? 1 : Math.PI / 180;
  const fix = n => Math.abs(n) < 1e-12 ? 0 : n;
  const funcs = {
    sin:v=>fix(Math.sin(v*D)), cos:v=>fix(Math.cos(v*D)),
    tan:v=>{ if (Math.abs(Math.cos(v*D)) < 1e-12) throw 'div0'; return fix(Math.tan(v*D)); },
    asin:v=>Math.asin(v)/D, acos:v=>Math.acos(v)/D, atan:v=>Math.atan(v)/D,
    lg:v=>Math.log10(v), ln:v=>Math.log(v)
  };
  let tokens = expression.match(TOKEN) || [];
  if (!tokens.length) throw 'error';
  const isValue = x => x !== undefined && (/^[\d.]/.test(x) || 'πe)%!'.includes(x));
  const startsValue = x => x !== undefined && (/^[\d.]/.test(x) || 'πe(√'.includes(x) || /^[a-z]{2,}$/.test(x));
  const expanded = []; let depth = 0;
  for (const x of tokens) {
    if (isValue(expanded[expanded.length-1]) && startsValue(x)) expanded.push('×');
    if (x === '(') depth++;
    if (x === ')') { if (depth === 0) throw 'error'; depth--; }
    expanded.push(x);
  }
  while (expanded.length) {
    const last = expanded[expanded.length-1];
    if (last === '(' || '+−×÷^√'.includes(last) || /^[a-z]{2,}$/.test(last)) expanded.pop();
    else break;
  }
  if (!expanded.length) throw 'error';
  while (depth-- > 0) expanded.push(')');
  tokens = expanded;
  let i=0, percent=false;
  const peek=()=>tokens[i], next=()=>tokens[i++];
  const E=()=>{ let left=T(); while(peek()==='+' || peek()==='−') {
    const op=next(); let right=T(); if(percent) right=left*right;
    left=op==='+' ? left+right : left-right;
  } return left; };
  const T=()=>{ percent=false; let left=U(); while(peek()==='×'||peek()==='÷') {
    const op=next(), right=U(); if(op==='×') left*=right; else { if(right===0) throw 'div0'; left/=right; }
  } return left; };
  const U=()=>{ if(peek()==='−'){next();return -U();} if(peek()==='+'){next();return U();} return P(); };
  const P=()=>{ const base=Q(); if(peek()==='^'){next();return Math.pow(base,U());} return base; };
  const Q=()=>{ let v=A(); for(;;) {
    if(peek()==='%'){next();v/=100;percent=true;}
    else if(peek()==='!'){next();if(v<0||v>170||Math.floor(v)!==v)throw 'error';let f=1;for(let k=2;k<=v;k++)f*=k;v=f;}
    else break;
  } return v; };
  const A=()=>{
    const x=next(); if(x===undefined)throw 'error';
    if(/^[\d.]/.test(x)){const n=Number(x);if(!Number.isFinite(n))throw 'error';return n;}
    if(x==='π')return Math.PI; if(x==='e')return Math.E;
    if(x==='('){const v=E();if(next()!==')')throw 'error';return v;}
    if(x==='√'||funcs[x]){
      if(next()!=='(')throw 'error';
      const v=E(); if(next()!==')')throw 'error';
      if(x==='√'){if(v<0)throw 'error';return Math.sqrt(v);}
      if((x==='ln'||x==='lg')&&v<=0)throw 'error';
      if((x==='asin'||x==='acos')&&(v < -1 || v > 1))throw 'error';
      return funcs[x](v);
    }
    throw 'error';
  };
  const result=E();
  if(i!==tokens.length || !Number.isFinite(result))throw 'error';
  return result;
}

const KEYS = [['C','⌫','%','÷'],['7','8','9','×'],['4','5','6','−'],['1','2','3','+'],['M','0','.','=']];
function calculatorStep(state,key) {
  let {ex, fresh, sci, rad, second}=state, out='', history=null;
  const last=ex.slice(-1), isOp=x=>'+−×÷^'.includes(x);
  const start=()=>{if(fresh){ex='';fresh=false;}};
  const segment=()=>((ex.match(/\d*\.?\d*$/)||[''])[0]);
  const funcs={sin:second?'asin(':'sin(',cos:second?'acos(':'cos(',tan:second?'atan(':'tan(',lg:second?'10^(':'lg(',ln:second?'e^(':'ln(','√x':second?'^2':'√('};
  if(key==='M')return {...state,sci:!sci};
  if(key==='rad')return {...state,rad:!rad};
  if(key==='2nd')return {...state,second:!second};
  if(key==='C'||key==='AC'){ex='';fresh=false;}
  else if(key==='⌫'){ex=fresh?'':ex.replace(/(asin|acos|atan|sin|cos|tan|lg|ln)\($|.$/,'');fresh=false;}
  else if(/^\d$/.test(key)){start();if(segment()==='0')ex=ex.slice(0,-1);ex+=key;}
  else if(key==='.'){start();if(segment().includes('.'))return state;ex+=segment()?'.':'0.';}
  else if(key==='+'||key==='−'||key==='×'||key==='÷'||key==='xʸ'){
    const op=key==='xʸ'?'^':key;
    if(!ex){if(op==='−')ex='−';}
    else if(isOp(last)){ex=ex.slice(0,-1)+op;fresh=false;}
    else if(last==='('){if(op==='−')ex+=op;}
    else {ex+=op;fresh=false;}
  } else if(key==='('){start();ex+='(';}
  else if(key===')'){const depth=(ex.match(/\(/g)||[]).length-(ex.match(/\)/g)||[]).length;if(depth>0&&!isOp(last)&&last!=='(')ex+=')';}
  else if(funcs[key]){const f=funcs[key];if(f==='^2'){if(ex&&!isOp(last)&&last!=='(')ex+='^2';}else{start();ex+=f;}}
  else if(key==='π'||key==='e'){start();ex+=key;}
  else if(key==='x!'||key==='%'){if(/[\d.πe)%!]$/.test(ex))ex+=key==='x!'?'!':'%';}
  else if(key==='1/x'){if(ex)ex='1÷('+ex+')';}
  else if(key==='='){
    if(!ex)return state;
    try{const result=fmt(evaluate(ex,rad));history={e:ex,r:result,t:Date.now()};ex=result.replace(/-/g,'−');fresh=true;}
    catch(err){out=err==='div0'?"Can't divide by 0":'Error';ex='';fresh=false;}
  }
  return {ex, fresh, sci, rad, second, out, history};
}

const UNIT_GROUPS = {
  Length:[['Meter','m',1],['Kilometer','km',1000],['Centimeter','cm',.01],['Millimeter','mm',.001],['Mile','mi',1609.344],['Foot','ft',.3048],['Inch','in',.0254]],
  Mass:[['Kilogram','kg',1],['Gram','g',.001],['Milligram','mg',.000001],['Pound','lb',.45359237],['Ounce','oz',.028349523125]],
  Time:[['Second','s',1],['Minute','min',60],['Hour','h',3600],['Day','d',86400]],
  Data:[['Byte','B',1],['KB','KB',1024],['MB','MB',1048576],['GB','GB',1073741824]],
  Volume:[['Liter','L',1],['Milliliter','mL',.001],['US gallon','gal',3.785411784]],
  Speed:[['m/s','m/s',1],['km/h','km/h',1/3.6],['mph','mph',.44704]],
  Energy:[['Joule','J',1],['Kilojoule','kJ',1000],['Calorie','cal',4.184],['kWh','kWh',3600000]]
};
function App(){
  const [theme,setTheme]=useState('dark'), T=theme==='dark'?DARK:LIGHT;
  const [screen,setScreen]=useState('calc'), [expr,setExpr]=useState({ex:'',fresh:false,sci:false,rad:true,second:false,out:''});
  const [history,setHistory]=useState([]), [settings,setSettings]=useState(false), [menu,setMenu]=useState('main');
  const [group,setGroup]=useState('Length'), [from,setFrom]=useState(0), [to,setTo]=useState(1), [value,setValue]=useState('1');
  const [search,setSearch]=useState(''), [mini,setMini]=useState(false);
  const {width,height}=useWindowDimensions();
  const scale=useRef(new Animated.Value(1)).current;
  useEffect(()=>{
    AsyncStorage.multiGet(['calc_theme','calc_history']).then(items=>{
      if(items[0][1]==='dark'||items[0][1]==='light')setTheme(items[0][1]);
      if(items[1][1]){const parsed=JSON.parse(items[1][1]);if(Array.isArray(parsed))setHistory(parsed.filter(x=>x&&typeof x.e==='string'&&typeof x.r==='string'));}
    }).catch(()=>{});
  },[]);
  useEffect(()=>{AsyncStorage.setItem('calc_theme',theme).catch(()=>{});},[theme]);
  useEffect(()=>{AsyncStorage.setItem('calc_history',JSON.stringify(history)).catch(()=>{});},[history]);
  useEffect(()=>{Animated.spring(scale,{toValue:mini?.72:1,useNativeDriver:true}).start();},[mini]);
  useEffect(()=>{
    const sub=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(settings){setSettings(false);return true;}
      if(mini){setMini(false);return true;}
      if(screen!=='calc'){setScreen('calc');return true;}
      return false;
    });
    return ()=>sub.remove();
  },[screen,settings,mini]);
  const key=k=>{
    const next=calculatorStep(expr,k);setExpr(next);
    if(next.history)setHistory(old=>[...old,next.history].slice(-500));
  };
  const openGroup=g=>{setGroup(g);setFrom(0);setTo(1);setValue('1');setSearch('');setScreen('convert');};
  const units=UNIT_GROUPS[group]||UNIT_GROUPS.Length;
  const converted=()=>{
    const n=Number(value);if(!Number.isFinite(n))return 'Invalid input';
    return fmt(n*units[from][2]/units[to][2]);
  };
  const navButton=(label,action,icon)=> <Pressable onPress={action} style={{padding:12,alignItems:'center',justifyContent:'center'}}>{icon?<MI name={icon} size={23} color={T.tx}/>:<Text style={{color:T.tx,fontWeight:'700'}}>{label}</Text>}</Pressable>;
  const keyRows=KEYS;
  const keypad=keyRows.map((row,i)=><View key={i} style={{flexDirection:'row',flex:1}}>{row.map(k=>{
    const orange=['C','⌫','%','÷','×','−','+','='].includes(k);
    return <Pressable key={k} onPress={()=>key(k)} style={{flex:1,margin:4,borderRadius:50,backgroundColor:k==='='?T.or:T.key,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:27,color:orange?'#f0821a':T.tx,fontWeight:'600'}}>{k}</Text></Pressable>;
  })}</View>);
  return <Theme.Provider value={T}>
    <StatusBar backgroundColor={T.bg} barStyle={theme==='dark'?'light-content':'dark-content'}/>
    <Animated.View style={{flex:1,backgroundColor:T.bg,paddingTop:Platform.OS==='android'?(StatusBar.currentHeight||24):48,transform:[{scale}]}}>
      <View style={{height:54,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:10}}>
        {navButton('',()=>setMini(true),'arrow-collapse')}
        <View style={{flexDirection:'row',gap:20}}>
          <Pressable onPress={()=>setScreen('calc')}><Text style={{color:screen==='calc'?T.tx:T.gr,fontSize:17,fontWeight:'700'}}>Calculator</Text></Pressable>
          <Pressable onPress={()=>setScreen('menu')}><Text style={{color:screen==='menu'||screen==='convert'?T.tx:T.gr,fontSize:17,fontWeight:'700'}}>Converter</Text></Pressable>
        </View>
        {navButton('',()=>{setMenu('main');setSettings(true);},'dots-vertical')}
      </View>
      {screen==='calc'&&<View style={{flex:1}}>
        <View style={{flex:1,justifyContent:'flex-end',padding:20}}>
          {history.slice(-3).map((h,i)=><Text key={i} style={{color:T.gr,textAlign:'right',fontSize:15}}>{pretty(h.e)} = {h.r}</Text>)}
          <Text numberOfLines={2} style={{color:T.tx,textAlign:'right',fontSize:Math.max(28,Math.min(50,440/Math.max(expr.ex.length,9))),fontWeight:'700',marginTop:16}}>{expr.out||pretty(expr.ex)||'0'}</Text>
          <Text style={{color:T.gr,textAlign:'right',fontSize:17,minHeight:26}}>{!expr.fresh&&!expr.out&&expr.ex?(()=>{try{return '= '+fmt(evaluate(expr.ex,expr.rad));}catch(e){return '';}})():''}</Text>
        </View>
        <View style={{height:height*.53,paddingHorizontal:6,paddingBottom:8}}>{keypad}</View>
      </View>}
      {screen==='menu'&&<ScrollView contentContainerStyle={{flexDirection:'row',flexWrap:'wrap',paddingBottom:20}}>
        {Object.keys(UNIT_GROUPS).map((g,i)=><Pressable key={g} onPress={()=>openGroup(g)} style={{width:'33.33%',alignItems:'center',paddingVertical:24}}><MI name={['ruler','weight','clock-outline','database','cube-outline','speedometer','flask-outline'][i]} size={36} color={T.tx}/><Text style={{color:T.tx,fontWeight:'700',marginTop:10}}>{g}</Text></Pressable>)}
      </ScrollView>}
      {screen==='convert'&&<View style={{flex:1,padding:18}}>
        <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>{navButton('',()=>setScreen('menu'),'arrow-left')}<Text style={{color:T.tx,fontSize:20,fontWeight:'700'}}>{group}</Text><View style={{width:42}}/></View>
        <TextInput value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder="Enter value" placeholderTextColor={T.gr} style={{color:T.tx,fontSize:26,borderBottomWidth:1,borderColor:T.ln,padding:12,marginVertical:20}}/>
        {[['From',from,setFrom],['To',to,setTo]].map(([label,selected,setter])=><View key={label} style={{marginBottom:20}}><Text style={{color:T.gr,marginBottom:8}}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{units.map((u,i)=><Pressable key={u[0]} onPress={()=>setter(i)} style={{padding:12,marginRight:7,borderRadius:10,backgroundColor:selected===i?T.or:T.chip}}><Text style={{color:selected===i?'#fff':T.tx}}>{u[0]}</Text></Pressable>)}</ScrollView></View>)}
        <View style={{backgroundColor:T.card,borderRadius:14,padding:20,marginTop:12}}><Text style={{color:T.gr}}>Result</Text><Text style={{color:T.or,fontSize:30,fontWeight:'700',marginTop:8}}>{converted()}</Text></View>
      </View>}
      <View style={{height:48,margin:8,borderWidth:1,borderStyle:'dashed',borderColor:T.ln,borderRadius:8,alignItems:'center',justifyContent:'center'}}><Text style={{color:T.gr,fontSize:11}}>Ad placeholder · {AD_UNIT_ID}</Text></View>
      {mini&&<Pressable onPress={()=>setMini(false)} style={{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'#0002',alignItems:'center',justifyContent:'center'}}><Text style={{color:'#fff',backgroundColor:T.or,padding:12,borderRadius:20}}>Tap to restore</Text></Pressable>}
    </Animated.View>
    <Modal visible={settings} transparent animationType="fade" onRequestClose={()=>setSettings(false)}>
      <Pressable onPress={()=>setSettings(false)} style={{flex:1,backgroundColor:'#0008',justifyContent:'flex-start',alignItems:'flex-end',paddingTop:70,paddingRight:12}}>
        <Pressable onPress={()=>{}} style={{width:230,backgroundColor:T.card,borderRadius:16,padding:14}}>
          <Text style={{color:T.gr,fontWeight:'700',marginBottom:8}}>Settings</Text>
          <Pressable onPress={()=>setMenu('themes')} style={{paddingVertical:12}}><Text style={{color:T.tx}}>Themes</Text></Pressable>
          {menu==='themes'&&<View style={{flexDirection:'row',gap:8}}><Pressable onPress={()=>{setTheme('dark');setSettings(false);}}><Text style={{color:T.tx,padding:8}}>Dark</Text></Pressable><Pressable onPress={()=>{setTheme('light');setSettings(false);}}><Text style={{color:T.tx,padding:8}}>Light</Text></Pressable></View>}
          <Pressable onPress={()=>{setHistory([]);setSettings(false);}} style={{paddingVertical:12}}><Text style={{color:T.tx}}>Clear history</Text></Pressable>
          <Text style={{color:T.tx,fontWeight:'700',marginTop:8}}>{APP_NAME}</Text><Text style={{color:T.gr,fontSize:12}}>Version {APP_VERSION} · {COMPANY}</Text>
        </Pressable>
      </Pressable>
    </Modal>
  </Theme.Provider>;
}

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { G, Line, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { humanizeTradingText } from '../presentation';
import type { Candle, TradeMarker } from '../types/trading';

type Props={
  data:Candle[]; price?:number; vwap?:number; goodZone?:[number,number]; breakout?:number; invalid?:number;
  target1?:number; target2?:number; averageCost?:number; maxEntry?:number; reviewTriggerPrice?:number;
  reviewTriggerLabel?:string; trades?:TradeMarker[];
};

type Level={id:string;price:number;label:string;color:string};
const GREEN='#35D99A',RED='#FF5B67',BLUE='#62A9FF',YELLOW='#F4B740',WHITE='#E9EDF2',GRID='#1D2D39',MUTED='#6F8398',BG='#09131D';
const PRICE_H=248,VOL_H=54,AXIS_H=24,TOTAL_H=PRICE_H+VOL_H+AXIS_H;

function levels(p:Props):Level[]{
 const out:Level[]=[];
 if(p.breakout)out.push({id:'breakout',price:p.breakout,label:`觀察價 ${p.breakout}`,color:WHITE});
 if(p.invalid)out.push({id:'invalid',price:p.invalid,label:`跌到要重看 ${p.invalid}`,color:RED});
 if(p.averageCost)out.push({id:'cost',price:p.averageCost,label:`成本 ${p.averageCost}`,color:BLUE});
 if(p.target1)out.push({id:'target1',price:p.target1,label:`第一目標 ${p.target1}`,color:GREEN});
 if(p.target2)out.push({id:'target2',price:p.target2,label:`主要目標 ${p.target2}`,color:GREEN});
 if(p.maxEntry)out.push({id:'maxEntry',price:p.maxEntry,label:`不再追高 ${p.maxEntry}`,color:YELLOW});
 if(p.reviewTriggerPrice&&p.reviewTriggerPrice!==p.breakout)out.push({id:'review',price:p.reviewTriggerPrice,label:`${humanizeTradingText(p.reviewTriggerLabel)||'重新確認'} ${p.reviewTriggerPrice}`,color:YELLOW});
 return out;
}
function StrategyStrip({items,goodZone}:{items:Level[];goodZone?:[number,number]}){
 const chips=[...(goodZone?[{id:'good',label:`留意區間 ${goodZone[0]}–${goodZone[1]}`,color:GREEN}]:[]),...items.filter(x=>x.id!=='cost').map(x=>({id:x.id,label:x.label,color:x.color}))];
 if(!chips.length)return null;
 return <View style={{flexDirection:'row',flexWrap:'wrap',gap:6,paddingHorizontal:12,paddingTop:8}}>{chips.map(x=><View key={x.id} style={{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:7,paddingVertical:4,borderRadius:7,backgroundColor:'#0D1A24'}}><View style={{width:6,height:6,borderRadius:3,backgroundColor:x.color}}/><Text style={{color:'#B9C6D3',fontSize:10,fontWeight:'700'}}>{x.label}</Text></View>)}</View>;
}

export function IntradayChart(props:Props){
 const {data,price,vwap,goodZone,trades=[]}=props;
 const [width,setWidth]=useState(0);
 const rows=(data||[]).slice(-300);
 const strategy=useMemo(()=>levels(props),[props.breakout,props.invalid,props.averageCost,props.target1,props.target2,props.maxEntry,props.reviewTriggerPrice,props.reviewTriggerLabel]);
 if(!rows.length)return <View style={{height:340,backgroundColor:BG,borderRadius:18,borderWidth:1,borderColor:'#233342',alignItems:'center',justifyContent:'center'}}><Text style={{color:MUTED}}>分時資料載入中</Text></View>;

 const W=Math.max(280,width||360),left=42,right=62,plotW=Math.max(140,W-left-right);
 const livePrice=Number.isFinite(Number(price))&&Number(price)>0?Number(price):null;
 const liveVwap=Number.isFinite(Number(vwap))&&Number(vwap)>0?Number(vwap):null;
 const anchor=livePrice??rows.at(-1)?.close??1;
 const extras=[...(livePrice!=null?[livePrice]:[]),...(liveVwap!=null?[liveVwap]:[])];
 const marketValues=rows.flatMap(r=>[r.low,r.high,r.close,r.average??r.close]).concat(extras).filter(Number.isFinite);
 const rawLo=Math.min(...marketValues),rawHi=Math.max(...marketValues),span=Math.max(rawHi-rawLo,anchor*.003,0.15),pad=Math.max(span*.10,anchor*.0015,0.08),lo=rawLo-pad,hi=rawHi+pad;
 const y=(p:number)=>Math.max(0,Math.min(PRICE_H,((hi-p)/(hi-lo))*PRICE_H));
 const x=(i:number)=>left+(rows.length<=1?0:i/(rows.length-1)*plotW);
 const maxVol=Math.max(...rows.map(r=>r.volume||0),1);
 const closePoints=rows.map((r,i)=>`${x(i).toFixed(2)},${y(r.close).toFixed(2)}`).join(' ');
 const avgPoints=rows.map((r,i)=>`${x(i).toFixed(2)},${y(r.average??liveVwap??r.close).toFixed(2)}`).join(' ');
 const visible=strategy.filter(l=>['breakout','review','invalid','cost'].includes(l.id)&&l.price>=lo&&l.price<=hi);
 const currentY=livePrice!=null?y(livePrice):null;
 const yTicks=[hi,(hi+lo)/2,lo];
 const fmt=(n:number)=>n.toFixed(n>=100?1:2).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1');

 return <View onLayout={e=>setWidth(e.nativeEvent.layout.width)} style={{backgroundColor:BG,borderRadius:18,overflow:'hidden',borderWidth:1,borderColor:'#233342',paddingBottom:8}}>
  <Svg width="100%" height={TOTAL_H} viewBox={`0 0 ${W} ${TOTAL_H}`}>
   <Rect x={0} y={0} width={W} height={TOTAL_H} fill={BG}/>
   {[.25,.5,.75].map(k=><Line key={k} x1={left} x2={left+plotW} y1={PRICE_H*k} y2={PRICE_H*k} stroke={GRID} strokeWidth={1}/>) }
   {yTicks.map((v,i)=><SvgText key={i} x={4} y={Math.max(11,Math.min(PRICE_H-3,y(v)+4))} fill="#53697A" fontSize={9}>{fmt(v)}</SvgText>)}
   {goodZone&&goodZone[1]>=lo&&goodZone[0]<=hi?<Rect x={left} width={plotW} y={y(Math.min(hi,goodZone[1]))} height={Math.max(2,y(Math.max(lo,goodZone[0]))-y(Math.min(hi,goodZone[1])))} fill="rgba(53,217,154,.08)" stroke="rgba(53,217,154,.25)" strokeWidth={1}/>:null}
   {visible.map(l=><Line key={l.id} x1={left} x2={left+plotW} y1={y(l.price)} y2={y(l.price)} stroke={l.color} strokeWidth={1} strokeDasharray="5 4" opacity={.42}/>)}
   {currentY!=null?<Line x1={left} x2={left+plotW} y1={currentY} y2={currentY} stroke={RED} strokeWidth={1.2} opacity={.9}/>:null}
   <Polyline points={closePoints} fill="none" stroke={WHITE} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
   <Polyline points={avgPoints} fill="none" stroke={YELLOW} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" opacity={.9} vectorEffect="non-scaling-stroke"/>
   {currentY!=null&&livePrice!=null?<G><Rect x={left+plotW+5} y={Math.max(2,Math.min(PRICE_H-22,currentY-10))} rx={6} width={right-10} height={20} fill={RED}/><SvgText x={left+plotW+9} y={Math.max(15,Math.min(PRICE_H-8,currentY+4))} fill="#fff" fontSize={10} fontWeight="700">{fmt(livePrice)}</SvgText></G>:null}
   {trades.slice(-4).map((t,i)=>{const ti=t.executedAt||t.createdAt||t.timestamp;if(!ti)return null;const target=new Date(ti).getTime();let best=0,dist=Infinity;rows.forEach((r,j)=>{const d=Math.abs(new Date(r.date).getTime()-target);if(d<dist){dist=d;best=j}});const px=x(best),py=y(t.price),buy=t.side==='BUY';const pts=buy?`${px},${py-8} ${px-5},${py} ${px+5},${py}`:`${px},${py+8} ${px-5},${py} ${px+5},${py}`;return <Polygon key={`${t.id||i}`} points={pts} fill={buy?GREEN:RED}/>})}
   <Line x1={left} x2={left+plotW} y1={PRICE_H+4} y2={PRICE_H+4} stroke={GRID} strokeWidth={1}/>
   {rows.map((r,i)=>{const bw=Math.max(.65,plotW/Math.max(1,rows.length)*.72),vh=Math.max(1,(r.volume||0)/maxVol*(VOL_H-10));return <Rect key={`v${i}`} x={x(i)-bw/2} y={PRICE_H+VOL_H-vh} width={bw} height={vh} fill={r.close>=r.open?GREEN:RED} opacity={.62}/>})}
   <SvgText x={left} y={TOTAL_H-5} fill={WHITE} fontSize={9}>價格</SvgText>
   <SvgText x={left+34} y={TOTAL_H-5} fill={YELLOW} fontSize={9}>盤中均價</SvgText>
   <SvgText x={left+plotW-70} y={TOTAL_H-5} fill={MUTED} fontSize={9}>09:00 → 13:30</SvgText>
  </Svg>
  <StrategyStrip items={strategy} goodZone={goodZone}/>
 </View>;
}

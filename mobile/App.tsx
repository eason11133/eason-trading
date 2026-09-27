import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Modal, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { CandleChart } from './src/components/CandleChart';
import { IntradayChart } from './src/components/IntradayChart';
import { Sparkline } from './src/components/Sparkline';
import { AlertBanner } from './src/components/AlertBanner';
import { TradeModal } from './src/components/TradeModal';
import { QuickTradeModal } from './src/components/QuickTradeModal';
import { BrokerageSettingsModal } from './src/components/BrokerageSettingsModal';
import { PairingModal } from './src/components/PairingModal';
import {
  createHandoff, fetchHandoff, fetchAlerts, fetchCandles, fetchFounderBrief, fetchHealth,
  fetchLatestClosePackage, generateClosePackage, fetchRadar, fetchSettings, fetchStockContext,
  recordTrade, saveSettings, setBackendFocus, adjustPosition, addPosition, removePosition, updateCash, previewGptUpdate, applyGptUpdate, fetchReviewInbox, undoLastGptUpdate, fetchCloudReviewHandoff, fetchLedgerMutationStatuses
} from './src/api';
import { configurePush, subscribeNotificationResponses } from './src/push';
import type { PushSetupResult } from './src/push';
import { connectFocus } from './src/focus';
import { candleCacheFresh, getCachedCandles, putCachedCandles } from './src/candleCache';
import {getConnection,initializeConnection} from './src/connection';
import {deriveMobileConnectionState} from './src/pairingState';
import {humanizeTradingText,volumeDescription} from './src/presentation';
import type {MobileConnectionState} from './src/pairingState';
import type { AppSettings, Candle, ChartMode, ClosePackage, HealthStatus, Portfolio, RadarAlert, ReviewInboxEvent, SetupStage, StockContext, StockSnapshot, TradeSide } from './src/types/trading';

const C = { bg:'#050B11', card:'#0B1620', card2:'#0E1C28', border:'#20303E', text:'#F4F7FA', muted:'#8DA0B4', green:'#35D99A', red:'#FF5B67', yellow:'#F4B740', blue:'#62A9FF' };
const money=(n:number|null|undefined)=>n==null?'—':`NT$ ${Number(n).toLocaleString('en-US',{maximumFractionDigits:0})}`;
const gainColor=(n:number)=>n>=0?C.red:C.green;
function taipeiClockParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value])) as Record<string,string>;
}
function taipeiDateString(date=new Date()){const p=taipeiClockParts(date);return `${p.year}-${p.month}-${p.day}`;}
function taipeiMarketOpenNow(date=new Date()){const p=taipeiClockParts(date);if(p.weekday==='Sat'||p.weekday==='Sun')return false;const m=Number(p.hour)*60+Number(p.minute);return m>=9*60&&m<13*60+30;}
function liveChartRows(rows:Candle[],mode:ChartMode,market:any){if(!rows.length||!market?.price||!['timeline','1m','5m'].includes(mode))return rows;const now=new Date();const bucket=(d:Date)=>{const m=mode==='5m'?Math.floor(d.getMinutes()/5)*5:d.getMinutes();return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${m}`};const last={...rows[rows.length-1]};const lastDate=new Date(last.date);const px=Number(market.price),avg=Number(market.vwap??px);if(bucket(lastDate)===bucket(now)){last.close=px;last.high=Math.max(last.high,px);last.low=Math.min(last.low,px);last.average=avg;return [...rows.slice(0,-1),last]}return [...rows,{date:now.toISOString(),open:last.close,high:Math.max(last.close,px),low:Math.min(last.close,px),close:px,volume:0,average:avg}].slice(-Math.max(rows.length,120));}

type Tab='首頁'|'提醒'|'更多'|'持股'|'監控';
type HandoffInput={type:'TRIGGER_REVIEW'|'CLOSE_REVIEW'|'NIGHT_SELECTION'|'STOCK_REVIEW'|'RADAR_SYNC';symbol?:string;eventId?:string;snapshotId?:string;closePackageId?:string};

export default function App() {
  const [tab,setTab]=useState<Tab>('首頁');
  const [selectedSymbol,setSelectedSymbol]=useState<string|null>(null);
  const [stocks,setStocks]=useState<StockSnapshot[]>([]);
  const [portfolio,setPortfolio]=useState<Portfolio>({totalAssets:null,totalAssetsTrusted:false,cash:0,cashKnown:false,marketValue:null,pnl:null,pnlPct:null});
  const [health,setHealth]=useState<HealthStatus|null>(null);
  const [alerts,setAlerts]=useState<RadarAlert[]>([]);
  const [closePackage,setClosePackage]=useState<ClosePackage|null>(null);
  const [settings,setSettings]=useState<AppSettings>({stockChatUrl:''});
  const [reviewInbox,setReviewInbox]=useState<ReviewInboxEvent[]>([]);
  const [pushStatus,setPushStatus]=useState<PushSetupResult|null>(null);
  const [brokerageOpen,setBrokerageOpen]=useState(false);
  const [pairingOpen,setPairingOpen]=useState(false);
  const [chatSettingsOpen,setChatSettingsOpen]=useState(false);
  const [banner,setBanner]=useState<RadarAlert|null>(null);
  const [connectionState,setConnectionState]=useState<MobileConnectionState|null>(null);
  const alertCursor=useRef<string|null>(null);
  const alive=useRef(true);
  const lastGptClipboard=useRef('');
  const deviceCredentialsConfirmed=useRef(false);

  const refresh=useCallback(async()=>{
    const connection=await initializeConnection().catch(()=>getConnection());
    if(!alive.current)return;
    if(deriveMobileConnectionState(connection,false)==='UNPAIRED'){
      setConnectionState('UNPAIRED');setHealth(null);return;
    }
    const deviceCredentialProbe=deviceCredentialsConfirmed.current?Promise.resolve([]):fetchLedgerMutationStatuses();
    const [r,b,h,cp,st,ri,deviceCredentials]=await Promise.allSettled([fetchRadar(),fetchFounderBrief(),fetchHealth(),fetchLatestClosePackage(),fetchSettings(),fetchReviewInbox(),deviceCredentialProbe]);
    if(!alive.current)return;
    const authInvalid=[h,deviceCredentials].some(x=>x.status==='rejected'&&String((x as PromiseRejectedResult).reason?.message||'')==='PAIRING_INVALID');
    if(authInvalid){setConnectionState('UNPAIRED');setHealth(null);return;}
    if(deviceCredentials.status==='fulfilled')deviceCredentialsConfirmed.current=true;
    if(r.status==='fulfilled')setStocks(r.value);
    if(b.status==='fulfilled'&&b.value?.portfolio)setPortfolio(b.value.portfolio);
    if(h.status==='fulfilled'){setHealth(h.value);setConnectionState('PAIRED_AND_ONLINE');}else setConnectionState(deriveMobileConnectionState(getConnection(),'UNREACHABLE'));
    if(cp.status==='fulfilled')setClosePackage(cp.value);
    if(st.status==='fulfilled')setSettings(st.value);
    if(ri.status==='fulfilled')setReviewInbox(ri.value as ReviewInboxEvent[]);
  },[]);

  useEffect(()=>{
    alive.current=true; refresh(); configurePush().then(x=>{if(alive.current)setPushStatus(x)}).catch(e=>{if(alive.current)setPushStatus({ok:false,reason:'TOKEN_FAILED',error:e?.message||String(e)})});
    const closeFocus=connectFocus(snapshot=>setStocks(prev=>prev.map(s=>s.symbol===snapshot.symbol?{...s,...snapshot}:s)));
    fetchAlerts().then(x=>{if(!alive.current)return;setAlerts(x);if(x[0])alertCursor.current=x[0].createdAt;}).catch(()=>{});
    const radarTimer=setInterval(()=>{if(AppState.currentState==='active')refresh().catch(()=>{})},5000);
    const alertTimer=setInterval(async()=>{
      if(AppState.currentState!=='active')return;
      try{const x=await fetchAlerts(alertCursor.current||undefined);if(!alive.current||!x.length)return;setAlerts(prev=>[...x,...prev].slice(0,100));const latest=x[0];alertCursor.current=latest.createdAt;setBanner(latest);}catch{}
    },5000);
    return()=>{alive.current=false;closeFocus();clearInterval(radarTimer);clearInterval(alertTimer)};
  },[refresh]);

  const selected=selectedSymbol?stocks.find(x=>x.symbol===selectedSymbol)||null:null;

  async function launchHandoff(input:HandoffInput){
    try{
      const created:any=await createHandoff(input);
      refresh().catch(()=>{});
      const url=created.stockChatUrl||settings.stockChatUrl;
      if(!url){setChatSettingsOpen(true);return;}
      if(created.gptBridge?.ok===false&&!created.gptBridge?.skipped){
        const full=await fetchHandoff(created.id);
        const fallback=full.copyText||created.prompt;
        if(fallback)await Clipboard.setStringAsync(fallback);
        Alert.alert('GPT 直連同步失敗','這次才啟用備用剪貼簿。已保留 handoff，開 GPT 後可貼上備用資料。',[{text:'開 GPT',onPress:()=>Linking.openURL(url).catch(()=>{})}]);
        return;
      }
      await Linking.openURL(url);
    }catch(e:any){Alert.alert('資料交接失敗',e?.message||'請稍後再試');}
  }

  const openAlert=()=>{
    const a=banner;setBanner(null);if(!a)return;
    if(a.type==='GPT_REVIEW'){launchHandoff({type:'TRIGGER_REVIEW',symbol:a.symbol,eventId:a.triggerEventId,snapshotId:a.snapshotId}).catch(()=>{});return;}
    if(a.type==='NIGHT_READY'){launchHandoff({type:'NIGHT_SELECTION'}).catch(()=>{});return;}
    if(a.symbol)setSelectedSymbol(a.symbol);
  };

  async function saveChatUrl(url:string){const x=await saveSettings({stockChatUrl:url});setSettings(x);setChatSettingsOpen(false);Alert.alert('已儲存','之後會固定回到這個股票對話。');}
  async function saveBrokerage(brokerage:NonNullable<AppSettings['brokerage']>){const x=await saveSettings({brokerage});setSettings(x);setBrokerageOpen(false);await refresh();Alert.alert('已儲存','之後成交試算與帳本都會用這份券商規則。');}

  async function openStockChat(){
    if(!settings.stockChatUrl){setChatSettingsOpen(true);return;}
    try{await Linking.openURL(settings.stockChatUrl)}catch(e:any){Alert.alert('無法開啟 GPT 對話',e?.message||'請重新設定網址')}
  }

  async function reviewClose(){
    try{
      const cp=await generateClosePackage();
      setClosePackage(cp);
      await launchHandoff({type:'CLOSE_REVIEW',closePackageId:cp.id});
    }catch(e:any){Alert.alert('收盤資料整理失敗',e?.message||'請稍後再試');}
  }

  async function offerGptUpdate(text:string,automatic=false){
    const raw=String(text||'').trim();
    if(automatic&&raw.includes('[EASON TRADING APP HANDOFF]'))return;
    if(automatic&&!raw.includes('EASON_TRADING_UPDATE_V1'))return;
    if(automatic&&lastGptClipboard.current===raw)return;
    try{
      const preview=await previewGptUpdate(raw);
      if(automatic)lastGptClipboard.current=raw;
      if(preview.duplicate){if(!automatic)Alert.alert('這份已套用過','不會重複新增觀察項目或提醒條件。');return;}
      const rows=(preview.rows||[]).slice(0,8).map((x:any)=>{const changes=(x.changes||[]).slice(0,4).map((c:any)=>`${c.field}: ${c.before??'—'} → ${Array.isArray(c.after)?c.after.join('–'):c.after}`).join('；');return `${x.symbol} ${x.name||''} · ${x.action}${changes?`\n${changes}`:''}`}).join('\n\n');
      const more=(preview.rows||[]).length>8?`\n…另外 ${(preview.rows||[]).length-8} 檔`:'';
      Alert.alert('套用 GPT 結果？',`${preview.total} 檔 · ${preview.changeCount||0} 項變更 · ${preview.triggerCount||0} 個提醒條件${preview.summary?`\n${preview.summary}`:''}\n\n${rows}${more}`,[{text:'取消',style:'cancel'},{text:'套用',onPress:async()=>{try{const result=await applyGptUpdate(raw);lastGptClipboard.current=raw;await refresh();Alert.alert('已套用',`觀察清單已更新 ${result.total} 檔；${result.triggerCount||0} 個提醒條件。`,[{text:'復原這次',style:'destructive',onPress:async()=>{try{await undoLastGptUpdate();await refresh();Alert.alert('已復原','只復原觀察設定／提醒條件，不會動持股、現金或成交。')}catch(e:any){Alert.alert('復原失敗',e?.message||'無法復原')}}},{text:'完成'}])}catch(e:any){Alert.alert('套用失敗',e?.message||'請重新複製 GPT 回覆')}}}]);
    }catch(e:any){if(!automatic)Alert.alert('讀不到 GPT 更新',e?.message||'請先複製股票 GPT 的完整回覆');}
  }

  async function importGptClipboard(){await offerGptUpdate(await Clipboard.getStringAsync(),false);}

  async function launchCloudReview(cloudEventUrl?:string,stockChatUrl?:string){
    if(!cloudEventUrl){Alert.alert('雲端事件缺資料','這個通知缺少可讀取的雲端事件資料。');return;}
    try{
      await fetchCloudReviewHandoff(cloudEventUrl); // marks the exact cloud event GPT_SENT; GPT Action reads it from Cloud.
      const url=stockChatUrl||settings.stockChatUrl;
      if(url)await Linking.openURL(url);
      else setChatSettingsOpen(true);
    }catch(e:any){Alert.alert('讀取雲端提醒失敗',e?.message||'請稍後再試');}
  }


  useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state==='active')Clipboard.getStringAsync().then(text=>offerGptUpdate(text,true)).catch(()=>{})});return()=>sub.remove()},[refresh]);
  useEffect(()=>subscribeNotificationResponses(data=>{
    if(data.type==='GPT_REVIEW_CLOUD'){launchCloudReview(data.cloudEventUrl,data.stockChatUrl).catch(()=>{});return;}
    if(data.type==='GPT_REVIEW'){launchHandoff({type:'TRIGGER_REVIEW',symbol:data.symbol,eventId:data.triggerEventId,snapshotId:data.snapshotId}).catch(()=>{});return;}
    if(data.type==='NIGHT_READY'){launchHandoff({type:'NIGHT_SELECTION',closePackageId:data.closePackageId}).catch(()=>{});return;}
    if(data.symbol)setSelectedSymbol(data.symbol);
  }),[settings.stockChatUrl]);

  return <SafeAreaProvider><SafeAreaView style={s.safe} edges={['top','right','bottom','left']}><StatusBar barStyle="light-content" />
    {banner&&<AlertBanner alert={banner} onPress={openAlert} onClose={()=>setBanner(null)}/>}
    {connectionState==='UNPAIRED'?<TouchableOpacity style={s.backendError} onPress={()=>setPairingOpen(true)}><View style={{flex:1}}><Text style={s.backendErrorTitle}>尚未完成手機配對</Text><Text style={s.backendErrorSub}>第一次設定需要和電腦配對一次。</Text></View><Text style={s.backendErrorAction}>開始配對</Text></TouchableOpacity>:connectionState==='PAIRED_BUT_PC_OFFLINE'?<View style={[s.backendError,s.backendOffline]}><View style={{flex:1}}><Text style={[s.backendErrorTitle,s.backendOfflineTitle]}>電腦目前離線</Text><Text style={[s.backendErrorSub,s.backendOfflineSub]}>本機資料暫停更新；雲端監控與待同步資料仍可使用</Text></View></View>:null}
    {selected?<StockDetail stock={selected} onBack={()=>setSelectedSymbol(null)} onChanged={refresh} onHandoff={launchHandoff} />:<>
      <View style={s.body}>
        {tab==='首頁'?<Home stocks={stocks} health={health} closePackage={closePackage} reviewInbox={reviewInbox} onOpen={x=>setSelectedSymbol(x.symbol)} onHandoff={launchHandoff} onCloseReview={reviewClose} onMonitoring={()=>setTab('監控')}/>
        :tab==='提醒'?<Notifications alerts={alerts} reviewInbox={reviewInbox} pushStatus={pushStatus} health={health} onOpen={symbol=>symbol&&setSelectedSymbol(symbol)} onHandoff={launchHandoff}/>
        :tab==='更多'?<More health={health} pushStatus={pushStatus} settings={settings} onHoldings={()=>setTab('持股')} onMonitoring={()=>setTab('監控')} onChatSettings={()=>setChatSettingsOpen(true)} onBrokerSettings={()=>setBrokerageOpen(true)} onFallbackApply={importGptClipboard}/>
        :tab==='持股'?<Positions stocks={stocks} portfolio={portfolio} health={health} settings={settings} onBrokerSettings={()=>setBrokerageOpen(true)} onOpen={x=>setSelectedSymbol(x.symbol)} onRefresh={refresh}/>
        :<Monitoring stocks={stocks} reviewInbox={reviewInbox} onBack={()=>setTab('更多')} onOpen={x=>setSelectedSymbol(x.symbol)}/>}
      </View>
      <Bottom tab={tab} setTab={setTab}/>
    </>}
    <ChatUrlModal visible={chatSettingsOpen} current={settings.stockChatUrl||''} onClose={()=>setChatSettingsOpen(false)} onSave={saveChatUrl}/>
    <BrokerageSettingsModal visible={brokerageOpen} current={settings.brokerage} onClose={()=>setBrokerageOpen(false)} onSave={saveBrokerage}/>
    <PairingModal visible={pairingOpen} onClose={()=>setPairingOpen(false)} onPaired={async()=>{await refresh();const x=await configurePush();if(alive.current)setPushStatus(x)}}/>
  </SafeAreaView></SafeAreaProvider>;
}

function Header({title,sub,right}:{title:string;sub?:string;right?:React.ReactNode}){return <View style={{marginBottom:14}}><View style={s.rowBetween}><View style={{flex:1}}><Text style={s.title}>{title}</Text>{sub?<Text style={s.sub}>{sub}</Text>:null}</View>{right}</View></View>}

function StatusChip({label,state='neutral',detail}:{label:string;state?:'ok'|'warn'|'bad'|'neutral';detail?:string}){const color=state==='ok'?C.green:state==='warn'?C.yellow:state==='bad'?C.red:C.muted;return <View style={s.statusChip}><View style={[s.statusDot,{backgroundColor:color}]}/><Text style={s.statusText}>{label}</Text>{detail?<Text style={[s.statusDetail,{color}]}>{detail}</Text>:null}</View>}
function SmallAction({label,onPress,tone='default'}:{label:string;onPress:()=>void;tone?:'default'|'green'|'yellow'}){return <TouchableOpacity onPress={onPress} style={[s.smallAction,tone==='green'&&s.smallActionGreen,tone==='yellow'&&s.smallActionYellow]}><Text style={[s.smallActionText,tone==='green'&&{color:C.green},tone==='yellow'&&{color:C.yellow}]}>{label}</Text></TouchableOpacity>}

const stageText=(x?:SetupStage)=>({NEW_DISCOVERY:'剛加入觀察',WAIT_TRIGGER:'繼續等',TRIGGERED_NO_ENTRY:'出現值得看的變化',WAIT_PULLBACK:'等更好的時機',READY:'值得重新看',RECONFIRM:'需要再確認',LOW_PRIORITY:'先放著',POSITION_MANAGEMENT:'持股中',CLOSED_POSITION:'這筆已結束',INVALIDATED:'原本想法可能失效',EXPIRED:'暫時不用看',ARCHIVED:'已收起'} as Record<string,string>)[x||'']||'持續觀察';

function Home({stocks,health,closePackage,reviewInbox,onOpen,onHandoff,onCloseReview,onMonitoring}:{stocks:StockSnapshot[];health:HealthStatus|null;closePackage:ClosePackage|null;reviewInbox:ReviewInboxEvent[];onOpen:(x:StockSnapshot)=>void;onHandoff:(x:HandoffInput)=>Promise<void>;onCloseReview:()=>Promise<void>;onMonitoring:()=>void}) {
 const isOpen=health?.session?(health.session.isOpen===true||health.session.session==='OPEN'):taipeiMarketOpenNow();
 const pending=reviewInbox.filter(x=>x.reviewStatus!=='COMPLETED').sort((a,b)=>Date.parse(b.triggeredAt)-Date.parse(a.triggeredAt));
 const event=pending[0]||null;
 const monitored=health?.cloudMonitor?.armed??stocks.filter(x=>!['INVALIDATED','EXPIRED','ARCHIVED'].includes(x.setupStage||'')).length;
 const closeReady=closePackage?.date===taipeiDateString();
 const todayTriggered=closeReady?(closePackage?.triggerEvents?.length??0):0;
 const held=stocks.filter(x=>x.position).length;
 const closeDate=closeReady?(closePackage?.date||''):'';
 const eventStock=event?stocks.find(x=>x.symbol===event.symbol):null;
 const eventPrice=Number(event?.market?.price??eventStock?.price);
 const eventRvol=Number(event?.market?.rvol??eventStock?.rvol);
 const eventReason=humanizeTradingText(event?.decisionSummary||event?.reasons?.[0]||event?.label||'這檔出現值得重新看的變化');
 const eventVolume=volumeDescription(eventRvol);
 return <ScrollView contentContainerStyle={s.scroll}>
   <Header title="Eason Trading" sub={isOpen?'盤中安靜監控':'收盤後復盤'}/>
   {isOpen?<>
     {event?<View style={s.homeHeroActive}>
       <Text style={s.homeEyebrow}>{pending.length} 件需要我看一下</Text>
       <TouchableOpacity onPress={()=>eventStock&&onOpen(eventStock)}>
         <Text style={s.homeStock}>{event.name||eventStock?.name||event.symbol} <Text style={s.code}>{event.symbol}</Text></Text>
         {Number.isFinite(eventPrice)?<Text style={s.homePrice}>{eventPrice.toFixed(eventPrice>=100?1:2)}</Text>:null}
         <Text style={s.homeReason}>{eventReason}</Text>
         <Text style={s.homeMeta}>{eventVolume?`${eventVolume} · `:''}{new Date(event.triggeredAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}</Text>
       </TouchableOpacity>
       <TouchableOpacity style={s.primaryCta} onPress={()=>onHandoff({type:'TRIGGER_REVIEW',symbol:event.symbol,eventId:event.id,snapshotId:event.snapshotId})}><Text style={s.primaryCtaText}>問 GPT 一起看</Text></TouchableOpacity>
     </View>:<View style={s.homeHeroCalm}>
       <Text style={s.calmIcon}>✓</Text>
       <Text style={s.homeCalmTitle}>目前沒有需要處理的事</Text>
       <Text style={s.homeCalmSub}>系統正在背景幫我盯著 {monitored} 個項目，有需要再提醒我。</Text>
     </View>}
     <TouchableOpacity style={s.secondaryLine} onPress={onMonitoring}><Text style={s.secondaryLineTitle}>看看系統正在幫我盯什麼</Text><Text style={s.secondaryLineArrow}>›</Text></TouchableOpacity>
   </>:<>
     <View style={s.homeHeroClose}>
       <Text style={s.homeEyebrow}>{closeReady?'今日資料已整理':'今日資料待整理'}</Text>
       <Text style={s.closeTitle}>{closeReady?`${closeDate} 收盤資料`:'準備今天的收盤資料'}</Text>
       {closeReady?<Text style={s.homeCalmSub}>持股 {held} · 監控 {monitored} · 今日提醒 {todayTriggered} · 待確認 {pending.length}</Text>:<Text style={s.homeCalmSub}>按一次就整理今天的持股、行情、觀察設定與重要事件。</Text>}
       <TouchableOpacity style={s.primaryCta} onPress={onCloseReview}><Text style={s.primaryCtaText}>交給 GPT 復盤</Text></TouchableOpacity>
     </View>
     {closeReady?<View style={s.closeMiniGrid}><View style={s.closeMini}><Text style={s.label}>成交</Text><Text style={s.closeMiniValue}>{closePackage.actualTrading?.totalTrades??0}</Text></View><View style={s.closeMini}><Text style={s.label}>候選</Text><Text style={s.closeMiniValue}>{closePackage.rollingPool?.length??0}</Text></View><View style={s.closeMini}><Text style={s.label}>提醒</Text><Text style={s.closeMiniValue}>{todayTriggered}</Text></View><View style={s.closeMini}><Text style={s.label}>待確認</Text><Text style={s.closeMiniValue}>{pending.length}</Text></View></View>:null}
   </>}
 </ScrollView>
}

function Monitoring({stocks,reviewInbox,onBack,onOpen}:{stocks:StockSnapshot[];reviewInbox:ReviewInboxEvent[];onBack:()=>void;onOpen:(x:StockSnapshot)=>void}){
 const active=stocks.filter(x=>!['INVALIDATED','EXPIRED','ARCHIVED'].includes(x.setupStage||''));
 const pendingSymbols=new Set(reviewInbox.filter(x=>x.reviewStatus!=='COMPLETED').map(x=>x.symbol));
 return <ScrollView contentContainerStyle={s.scroll}>
   <TouchableOpacity onPress={onBack}><Text style={s.back}>‹ 更多</Text></TouchableOpacity>
   <Header title="系統正在幫我盯" sub="到了值得重看的時候才提醒我"/>
   {active.length?active.map(x=><TouchableOpacity key={x.symbol} style={s.monitorCard} onPress={()=>onOpen(x)}>
     <View style={s.rowBetween}><Text style={s.cardTitle}>{x.name} <Text style={s.code}>{x.symbol}</Text></Text>{pendingSymbols.has(x.symbol)?<Text style={s.monitorBadge}>待我確認</Text>:null}</View>
     <Text style={s.monitorState}>{stageText(x.setupStage)}{x.rating?` · ${x.rating}`:''}</Text>
     {x.nextStep?<Text style={s.monitorNext}>現在等：{humanizeTradingText(x.nextStep)}</Text>:null}
     <View style={s.monitorMetaRow}>{x.goodZone?<Text style={s.monitorMeta}>留意區間 {x.goodZone[0]}–{x.goodZone[1]}</Text>:null}{x.invalid?<Text style={[s.monitorMeta,{color:C.red}]}>跌到 {x.invalid} 元要重看</Text>:null}{x.breakout?<Text style={s.monitorMeta}>超過 {x.breakout} 元要重看</Text>:null}</View>
   </TouchableOpacity>):<Empty text="目前沒有需要系統幫我盯的項目"/>}
 </ScrollView>
}

function More({health,pushStatus,settings,onHoldings,onMonitoring,onChatSettings,onBrokerSettings,onFallbackApply}:{health:HealthStatus|null;pushStatus:PushSetupResult|null;settings:AppSettings;onHoldings:()=>void;onMonitoring:()=>void;onChatSettings:()=>void;onBrokerSettings:()=>void;onFallbackApply:()=>Promise<void>}){
 const gptOk=health?.gptDirect?.bridgeConfigured===true&&!health?.gptDirect?.lastError;
 const cloudOk=health?.cloudMonitorConfigured===true;
 const quoteOk=health?.marketDataVerified===true&&health?.quotesReady!==false;
 return <ScrollView contentContainerStyle={s.scroll}><Header title="更多" sub="平常不用進來"/>
   <TouchableOpacity style={s.menuRow} onPress={onHoldings}><View><Text style={s.menuTitle}>持股與帳本</Text><Text style={s.menuSub}>資產、成本、成交與持股細節</Text></View><Text style={s.secondaryLineArrow}>›</Text></TouchableOpacity>
   <TouchableOpacity style={s.menuRow} onPress={onMonitoring}><View><Text style={s.menuTitle}>正在幫我盯</Text><Text style={s.menuSub}>哪些股票、什麼情況需要再提醒我</Text></View><Text style={s.secondaryLineArrow}>›</Text></TouchableOpacity>
   <TouchableOpacity style={s.menuRow} onPress={onChatSettings}><View><Text style={s.menuTitle}>股票 GPT</Text><Text style={s.menuSub}>{settings.stockChatUrl?'已設定固定對話':'尚未設定固定對話'}</Text></View><Text style={s.secondaryLineArrow}>›</Text></TouchableOpacity>
   <TouchableOpacity style={s.menuRow} onPress={onBrokerSettings}><View><Text style={s.menuTitle}>交易成本設定</Text><Text style={s.menuSub}>手續費、折扣與稅</Text></View><Text style={s.secondaryLineArrow}>›</Text></TouchableOpacity>
   <Section title="系統狀態"><View style={s.systemStrip}><StatusChip label="行情" state={quoteOk?'ok':'warn'} detail={quoteOk?'正常':'檢查'}/><StatusChip label="雲端" state={cloudOk?'ok':'warn'} detail={cloudOk?'正常':'檢查'}/><StatusChip label="GPT" state={gptOk?'ok':'warn'} detail={gptOk?'正常':'檢查'}/><StatusChip label="通知" state={pushStatus?.ok?'ok':'warn'} detail={pushStatus?.ok?'正常':'檢查'}/></View></Section>
   {health?.gptDirect?.lastError?<View style={s.slimWarning}><Text style={s.slimWarningTitle}>GPT 最近錯誤</Text><Text style={s.slimWarningText}>{health.gptDirect.lastError}</Text></View>:null}
   <TouchableOpacity style={s.fallbackRow} onPress={onFallbackApply}><Text style={s.fallbackTitle}>手動套用 GPT 回覆</Text><Text style={s.menuSub}>只有自動同步真的失敗時才用</Text></TouchableOpacity>
 </ScrollView>
}

function Positions({stocks,portfolio,health,settings,onBrokerSettings,onOpen,onRefresh}:{stocks:StockSnapshot[];portfolio:Portfolio;health:HealthStatus|null;settings:AppSettings;onBrokerSettings:()=>void;onOpen:(x:StockSnapshot)=>void;onRefresh:()=>Promise<void>}) {
 const held=stocks.filter(x=>x.position);const[editing,setEditing]=useState<StockSnapshot|null>(null);const[adding,setAdding]=useState(false);const[cashOpen,setCashOpen]=useState(false);const[quickOpen,setQuickOpen]=useState(false);const[busy,setBusy]=useState(false);
 const[syncRows,setSyncRows]=useState<any[]>([]);useEffect(()=>{let live=true;const pull=()=>fetchLedgerMutationStatuses().then(x=>{if(live)setSyncRows(x)}).catch(()=>{});pull();const id=setInterval(pull,10000);return()=>{live=false;clearInterval(id)}},[]);const pendingSync=syncRows.filter(x=>x.status==='pending').length,rejectedSync=syncRows.filter(x=>x.status==='rejected').length;
 const accepted=()=>Alert.alert('已提交，待同步','變更已安全存入雲端佇列；電腦恢復連線後會由本機 Ledger 驗證並套用。');
 async function saveExisting(input:{symbol:string;quantity:number;averageCost:number}){if(!editing)return;setBusy(true);try{await adjustPosition(editing.symbol,input,editing.position?{quantity:editing.position.quantity,averageCost:editing.position.averageCost}:undefined);setEditing(null);accepted()}catch(e:any){Alert.alert('持股修正尚未提交',e?.message||'請確認網路後重試')}finally{setBusy(false)}}
 async function saveNew(input:{symbol:string;quantity:number;averageCost:number}){setBusy(true);try{await addPosition(input);setAdding(false);accepted()}catch(e:any){Alert.alert('加入持股尚未提交',e?.message||'請確認網路後重試')}finally{setBusy(false)}}
 async function remove(){if(!editing)return;Alert.alert('移除此持股？','這是修正帳本，不會建立 SELL 成交紀錄。',[{text:'取消',style:'cancel'},{text:'移除',style:'destructive',onPress:async()=>{setBusy(true);try{await removePosition(editing.symbol,editing.position?{quantity:editing.position.quantity,averageCost:editing.position.averageCost}:undefined);setEditing(null);accepted()}catch(e:any){Alert.alert('移除尚未提交',e?.message||'請確認網路後重試')}finally{setBusy(false)}}}]);}
 async function saveCash(value:number){setBusy(true);try{await updateCash(value,portfolio.cashKnown?portfolio.cash:undefined);setCashOpen(false);accepted()}catch(e:any){Alert.alert('現金修正尚未提交',e?.message||'請確認網路後重試')}finally{setBusy(false)}}
 const missingBroker=settings.brokerage?.configured!==true; const missingCash=portfolio.cashKnown===false; const missingCount=Number(missingBroker)+Number(missingCash);
 return <><ScrollView contentContainerStyle={s.scroll}>
   <Header title="持股" right={<View style={s.headerActions}><TouchableOpacity style={s.ghostMiniBtn} onPress={()=>setQuickOpen(true)}><Text style={s.ghostMiniText}>快速成交</Text></TouchableOpacity><TouchableOpacity style={s.tradeBtn} onPress={()=>setAdding(true)}><Text style={s.tradeText}>＋持股</Text></TouchableOpacity></View>}/>
   {pendingSync||rejectedSync?<View style={rejectedSync?s.slimWarning:s.slimInfo}><Text style={rejectedSync?s.slimWarningTitle:s.slimInfoText}>{rejectedSync?`同步失敗／需處理 ${rejectedSync} 筆`:`待同步 ${pendingSync} 筆`}</Text></View>:syncRows.length?<View style={s.slimInfo}><Text style={s.slimInfoText}>已同步</Text></View>:null}
   {portfolio.marketPending?<View style={s.slimInfo}><Text style={s.slimInfoText}>正在更新 {portfolio.marketPending} 檔即時行情</Text></View>:null}
   {missingCount>0?<View style={s.setupPanel}><View style={{flex:1}}><Text style={s.setupTitle}>還有 {missingCount} 項設定未完成</Text><Text style={s.setupSub}>完成後資產與交易成本才會完整</Text></View><View style={s.setupActions}>{missingBroker?<SmallAction label="交易成本" tone="yellow" onPress={onBrokerSettings}/>:null}{missingCash?<SmallAction label="現金" tone="yellow" onPress={()=>setCashOpen(true)}/>:null}</View></View>:<TouchableOpacity style={s.settingsLine} onPress={onBrokerSettings}><Text style={s.settingsLineText}>交易成本 {Number((settings.brokerage?.feeDiscount||1)*10).toFixed(2).replace(/\.00$/,'')} 折 · 整股最低 {settings.brokerage?.regularMinFee} · 零股最低 {settings.brokerage?.oddLotMinFee}</Text><Text style={s.settingsEdit}>編輯</Text></TouchableOpacity>}
   <View style={s.assetHero}><View style={s.assetMain}><Text style={s.label}>總資產</Text><Text style={s.assetValue}>{money(portfolio.totalAssets)}</Text></View><View style={s.assetSplit}><View style={{flex:1}}><Text style={s.label}>持股市值</Text><Text style={s.assetSubValue}>{money(portfolio.marketValue)}</Text></View><View style={{flex:1}}><View style={s.rowBetween}><Text style={s.label}>現金</Text><TouchableOpacity onPress={()=>setCashOpen(true)}><Text style={s.editCash}>編輯</Text></TouchableOpacity></View><Text style={s.assetSubValue}>{portfolio.cashKnown===false?'未設定':money(portfolio.cash)}</Text></View></View></View>
   <View style={[s.statRow,{marginTop:10}]}><Stat t="已實現" v={money(portfolio.realizedPnl||0)} c={(portfolio.realizedPnl||0)>=0?C.red:C.green}/><Stat t="未實現" v={money(portfolio.unrealizedNetPnl)} c={(portfolio.unrealizedNetPnl||0)>=0?C.red:C.green}/><Stat t="交易成本" v={money((portfolio.totalBrokerFees||0)+(portfolio.totalTransactionTax||0))} c={C.yellow}/></View>
   {portfolio.netPnlComplete===false?<TouchableOpacity style={s.slimWarning} onPress={()=>Alert.alert('歷史淨損益尚未完整','舊版／手動匯入部位沒有原始買進手續費。總資產仍照現金＋真實市值計算，但舊資料的淨損益不會假裝完全精確；新成交會保存完整交易成本。')}><Text style={s.slimWarningTitle}>歷史淨損益未完整</Text><Text style={s.slimWarningText}>只影響舊資料 · 點此看說明</Text></TouchableOpacity>:null}
   {health?.ledgerMode==='uninitialized'&&held.length===0?<View style={s.slimInfo}><Text style={s.slimInfoText}>目前是空帳本，可直接新增真實持股</Text></View>:null}
   <Section title={`目前持股 ${held.length} 檔`}>{held.length?held.map(x=><PositionCard key={x.symbol} x={x} onPress={()=>onOpen(x)} onEdit={()=>setEditing(x)}/>):<Empty text="目前沒有持股"/>}</Section>
 </ScrollView><QuickTradeModal visible={quickOpen} onClose={()=>setQuickOpen(false)} onDone={async()=>accepted()}/><PositionEditor visible={!!editing} title="編輯持股" stock={editing} busy={busy} onClose={()=>!busy&&setEditing(null)} onSubmit={saveExisting} onDelete={remove}/><PositionEditor visible={adding} title="加入持股" stock={null} busy={busy} onClose={()=>!busy&&setAdding(false)} onSubmit={saveNew}/><CashEditor visible={cashOpen} value={portfolio.cash} busy={busy} onClose={()=>!busy&&setCashOpen(false)} onSubmit={saveCash}/></>
}

function Notifications({alerts,reviewInbox,pushStatus,health,onOpen,onHandoff}:{alerts:RadarAlert[];reviewInbox:ReviewInboxEvent[];pushStatus:PushSetupResult|null;health:HealthStatus|null;onOpen:(symbol?:string)=>void;onHandoff:(x:HandoffInput)=>Promise<void>}){
 const pending=reviewInbox.filter(x=>x.reviewStatus!=='COMPLETED').sort((a,b)=>Date.parse(b.triggeredAt)-Date.parse(a.triggeredAt));
 const normalAlerts=alerts.filter(a=>a.type!=='GPT_REVIEW');
 const important=normalAlerts.filter(a=>a.level==='RISK'||a.level==='HOT');
 const system=normalAlerts.filter(a=>/CLOUD|PUSH|SYSTEM|PAIR/i.test(String(a.type||'')));
 const systemIds=new Set(system.map(x=>x.id));
 const records=normalAlerts.filter(a=>a.level!=='RISK'&&a.level!=='HOT'&&!systemIds.has(a.id)).slice(0,30);
 return <ScrollView contentContainerStyle={s.scroll}><Header title="今天要注意的事" sub="系統幫我盯著，有需要再來看"/>
   {pending.length?<Section title={`待我確認 ${pending.length}`}>{pending.map(e=>{const price=Number(e.market?.price);const volume=volumeDescription(Number(e.market?.rvol));return <View key={e.id} style={[s.notice,{borderColor:'#285743'}]}><TouchableOpacity onPress={()=>onOpen(e.symbol)}><Text style={[s.cardTitle,{fontSize:17}]}>{e.name||e.symbol} <Text style={s.code}>{e.symbol}</Text></Text><Text style={s.bodyText}>{humanizeTradingText(e.decisionSummary||e.reasons?.[0]||e.label||'這檔出現值得重新看的變化')}</Text>{Number.isFinite(price)?<Text style={s.eventMeta}>當時 {price.toFixed(price>=100?1:2)} 元{volume?` · ${volume}`:''}</Text>:volume?<Text style={s.eventMeta}>{volume}</Text>:null}<Text style={s.timestamp}>{new Date(e.triggeredAt).toLocaleString('zh-TW')}</Text><Text style={s.openHint}>點一下看當時狀況</Text></TouchableOpacity><TouchableOpacity style={[s.gptBtn,{marginTop:10}]} onPress={()=>onHandoff({type:'TRIGGER_REVIEW',symbol:e.symbol,eventId:e.id,snapshotId:e.snapshotId})}><Text style={s.gptBtnText}>問 GPT 一起看</Text></TouchableOpacity></View>})}</Section>:null}
   {important.length?<Section title="需要留意">{important.map(a=><NotificationCard key={a.id} alert={a} onOpen={onOpen} onHandoff={onHandoff}/>)}</Section>:null}
   <Section title="最近發生">{records.length?records.map(a=><NotificationCard key={a.id} alert={a} onOpen={onOpen} onHandoff={onHandoff} compact/>):<Empty text="目前沒有其他需要看的事"/>}</Section>
   {system.length?<Section title="系統紀錄"><View style={s.systemHistory}><Text style={s.menuSub}>{system.length} 筆系統事件已收合。系統健康狀態請到「更多」。</Text></View></Section>:null}
 </ScrollView>}

function NotificationCard({alert:a,onOpen,onHandoff,compact=false}:{alert:RadarAlert;onOpen:(symbol?:string)=>void;onHandoff:(x:HandoffInput)=>Promise<void>;compact?:boolean}){return <View style={[compact?s.noticeCompact:s.notice,{borderColor:a.level==='RISK'?'#6A2933':a.level==='HOT'?'#59451B':C.border}]}><TouchableOpacity onPress={()=>onOpen(a.symbol)}><Text style={[s.cardTitle,{fontSize:compact?15:17}]}>{a.level==='RISK'?'⚠ ':a.level==='HOT'?'● ':''}{humanizeTradingText(a.title)}</Text><Text style={[s.bodyText,compact&&{fontWeight:'500',color:C.muted}]} numberOfLines={compact?3:undefined}>{humanizeTradingText(a.body)}</Text><Text style={s.timestamp}>{new Date(a.createdAt).toLocaleString('zh-TW')}</Text></TouchableOpacity>{a.type==='NIGHT_READY'&&<TouchableOpacity style={[s.gptBtn,{marginTop:9}]} onPress={()=>onHandoff({type:'NIGHT_SELECTION'})}><Text style={s.gptBtnText}>整理今晚觀察名單</Text></TouchableOpacity>}</View>}

function StockDetail({stock,onBack,onChanged,onHandoff}:{stock:StockSnapshot;onBack:()=>void;onChanged:()=>Promise<void>;onHandoff:(x:HandoffInput)=>Promise<void>}) {
 const [mode,setMode]=useState<ChartMode>('timeline');
 const initial=getCachedCandles(stock.symbol,'timeline');
 const [candles,setCandles]=useState<Candle[]>(()=>initial?.data||[]);
 const [source,setSource]=useState(()=>initial?.source||'');
 const [updatedAt,setUpdatedAt]=useState<string|undefined>(()=>initial?.updatedAt);
 const [refreshing,setRefreshing]=useState(false);
 const [context,setContext]=useState<StockContext|null>(null);
 const [tradeOpen,setTradeOpen]=useState(false);
 const load=useCallback(async(force=false)=>{const cached=getCachedCandles(stock.symbol,mode);if(cached){setCandles(cached.data);setSource(cached.source);setUpdatedAt(cached.updatedAt)}if(!force&&candleCacheFresh(stock.symbol,mode))return;setRefreshing(true);try{const x=await fetchCandles(stock.symbol,mode);putCachedCandles(stock.symbol,mode,x);setCandles(x.data);setSource(x.source);setUpdatedAt(x.updatedAt)}catch{}finally{setRefreshing(false)}},[stock.symbol,mode]);
 useEffect(()=>{load();const ms=mode==='timeline'?15000:mode==='daily'?30000:60000;const id=setInterval(()=>{if(AppState.currentState==='active')load(true)},ms);return()=>clearInterval(id)},[load,mode]);
 useEffect(()=>{let active=true;setBackendFocus(stock.symbol).catch(()=>{});const pull=()=>fetchStockContext(stock.symbol).then(x=>{if(active)setContext(x)}).catch(()=>{});pull();const contextTimer=setInterval(()=>{if(AppState.currentState==='active')pull()},2000);const prefetch:ChartMode[]=['daily','weekly'];prefetch.forEach(m=>{if(!getCachedCandles(stock.symbol,m)){fetchCandles(stock.symbol,m).then(x=>putCachedCandles(stock.symbol,m,x)).catch(()=>{})}});return()=>{active=false;clearInterval(contextTimer);setBackendFocus().catch(()=>{})}},[stock.symbol]);
 async function submitTrade(x:{side:TradeSide;quantity:number;price:number}){await recordTrade({symbol:stock.symbol,name:stock.name,...x});Alert.alert('已提交，待同步','成交已安全存入雲端佇列；電腦端帳本驗證完成前不會顯示為已完成。');}
 const liveMarket=(context?.market as any)||stock;const displayPrice=Number(liveMarket?.price??stock.price);const displayChange=Number(liveMarket?.changePct??stock.changePct);const displayHigh=Number(liveMarket?.high??stock.high);const displayLow=Number(liveMarket?.low??stock.low);const displayVwap=Number(liveMarket?.vwap??stock.vwap);const displayRvol=Number(liveMarket?.rvol??stock.rvol);const quoteSource=String(liveMarket?.source||'');const marketTrusted=quoteSource.startsWith('fugle')&&liveMarket?.dataFresh!==false&&Number.isFinite(displayPrice)&&displayPrice>0;
 const candlesLive=String(source||'').startsWith('fugle');const sourceLabel=marketTrusted&&candlesLive?'● 即時行情正常':candlesLive?'◌ 圖表正常 · 現價同步中':source==='fugle-error'||source==='market-data-unavailable'?'⚠ 行情資料暫時不可用':source?'◌ 行情同步中':'◌ 讀取行情';
 const armedReview=context?.reviewTriggers?.[0];const reviewPriceCondition=armedReview?.conditions?.all?.find((x:any)=>x.field==='price');const reviewPrice=reviewPriceCondition?.value??(context?.playbook as any)?.reviewTriggerPrice??stock.reviewTriggerPrice;const reviewLabel=armedReview?.label??(context?.playbook as any)?.reviewTriggerLabel??stock.reviewTriggerLabel;const latestEvent=context?.triggerEvents?.[0];
 const displayCandles=liveChartRows(candles,mode,marketTrusted?liveMarket:null);const chartProps={price:marketTrusted?displayPrice:undefined,goodZone:stock.goodZone,breakout:stock.breakout,invalid:stock.invalid,target1:stock.target1,target2:stock.target2,averageCost:stock.position?.averageCost,maxEntry:stock.maxEntry,reviewTriggerPrice:reviewPrice,reviewTriggerLabel:reviewLabel,trades:context?.trades||[]};
 const modes:{key:ChartMode;label:string}[]=[{key:'timeline',label:'分時'},{key:'daily',label:'日K'},{key:'weekly',label:'週K'}];
 return <View style={{flex:1}}><ScrollView contentContainerStyle={s.scroll}>
  <View style={s.rowBetween}><TouchableOpacity onPress={onBack}><Text style={s.back}>‹ 返回</Text></TouchableOpacity><TouchableOpacity onPress={()=>setTradeOpen(true)} style={s.tradeBtn}><Text style={s.tradeText}>＋成交</Text></TouchableOpacity></View>
  <View style={s.stockHead}><View style={{flex:1}}><Text style={s.title}>{liveMarket?.name||stock.name} <Text style={s.code}>{stock.symbol}</Text></Text><Text style={[s.price,{color:marketTrusted?gainColor(displayChange):C.muted}]}>{marketTrusted?displayPrice.toFixed(1):'—'} <Text style={{fontSize:22}}>{marketTrusted?`${displayChange>=0?'+':''}${displayChange.toFixed(1)}%`:'同步中'}</Text></Text>{stock.position?<Text style={s.positionMeta}>{stock.position.quantity}股 · 成本 {stock.position.averageCost}</Text>:null}</View></View>
  <View style={s.marketStrip}><Text style={s.marketStripText}>今日高 {marketTrusted?displayHigh:'—'}</Text><Text style={s.marketStripText}>今日低 {marketTrusted?displayLow:'—'}</Text><Text style={s.marketStripText}>{marketTrusted?(volumeDescription(displayRvol)||'成交量狀況同步中'):'成交量同步中'}</Text></View>
  {latestEvent&&<TouchableOpacity style={[s.gptBtn,{marginTop:10}]} onPress={()=>onHandoff({type:'TRIGGER_REVIEW',symbol:stock.symbol,eventId:latestEvent.id,snapshotId:latestEvent.snapshotId})}><Text style={s.gptBtnText}>問 GPT 一起看</Text></TouchableOpacity>}
  <View style={s.segment}>{modes.map(m=><TouchableOpacity key={m.key} style={[s.segBtn,mode===m.key&&s.segOn]} onPress={()=>setMode(m.key)}><Text style={[s.segText,mode===m.key&&{color:C.green}]}>{m.label}</Text></TouchableOpacity>)}</View>
  <View style={s.chartHeader}><Text style={[s.muted,{color:source==='fugle-live'?C.green:source==='fugle-error'||source==='market-data-unavailable'?C.red:C.muted}]}>{sourceLabel}{refreshing?' · 更新中':''}</Text><Text style={[s.muted,{fontSize:10}]}>{updatedAt?new Date(updatedAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}):''}</Text></View>
  {mode==='timeline'?<IntradayChart data={displayCandles} vwap={marketTrusted?displayVwap:undefined} {...chartProps}/>:<CandleChart candles={displayCandles} mode={mode as 'daily'|'weekly'} {...chartProps}/>}
 </ScrollView><TradeModal stock={stock} visible={tradeOpen} onClose={()=>setTradeOpen(false)} onSubmit={submitTrade}/></View>
}

function RadarCard({x,onPress}:{x:StockSnapshot;onPress:()=>void}){return <TouchableOpacity style={s.card} onPress={onPress}><View style={s.rowBetween}><View style={{flex:1}}><Text style={s.cardTitle}>{x.name} <Text style={s.code}>{x.symbol}</Text></Text><Text style={s.muted}>{stageText(x.setupStage)}{x.rating?` · ${x.rating}`:''}</Text><Text style={[s.price,{color:x.dataTrusted===false||x.dataFresh===false?C.muted:gainColor(x.changePct)}]}>{x.dataTrusted===false||x.dataFresh===false?'—':x.price.toFixed(1)} <Text style={{fontSize:18}}>{x.dataTrusted===false?'同步中':x.dataFresh===false?'暫停更新':`${x.changePct>=0?'+':''}${x.changePct.toFixed(1)}%`}</Text></Text></View><Sparkline values={x.spark}/></View><Text style={s.radarMeta}>{x.dataTrusted===false||x.dataFresh===false?'成交量同步中':(volumeDescription(x.rvol)||'成交量和平常差不多')}</Text>{x.nextStep?<View style={s.nextLine}><Text style={s.nextLineLabel}>現在等</Text><Text style={s.nextLineText}>{humanizeTradingText(x.nextStep)}</Text></View>:null}</TouchableOpacity>}
function PositionCard({x,onPress,onEdit}:{x:StockSnapshot;onPress:()=>void;onEdit:()=>void}){const p=x.position!;const unavailable=x.dataTrusted===false||x.dataFresh===false;const gain=unavailable?0:(x.price/p.averageCost-1)*100;const pnl=unavailable?0:(x.price-p.averageCost)*p.quantity;return <View style={s.card}><View style={s.rowBetween}><TouchableOpacity style={{flex:1}} onPress={onPress}><Text style={s.cardTitle}>{x.name} <Text style={s.code}>{x.symbol}</Text></Text><Text style={s.muted}>{p.quantity}股 · 成本 {p.averageCost}</Text><Text style={[s.price,{color:unavailable?C.muted:gainColor(gain)}]}>{unavailable?'—':x.price.toFixed(1)} <Text style={{fontSize:18}}>{x.dataTrusted===false?'同步中':x.dataFresh===false?'暫停更新':`${gain>=0?'+':''}${gain.toFixed(1)}%`}</Text></Text>{!unavailable?<Text style={[s.muted,{color:gainColor(pnl)}]}>{pnl>=0?'+':''}{money(pnl)}</Text>:null}</TouchableOpacity><TouchableOpacity style={s.editMiniBtn} onPress={onEdit}><Text style={s.editMiniText}>編輯</Text></TouchableOpacity></View></View>}
function PositionEditor({visible,title,stock,busy,onClose,onSubmit,onDelete}:{visible:boolean;title:string;stock:StockSnapshot|null;busy:boolean;onClose:()=>void;onSubmit:(x:{symbol:string;quantity:number;averageCost:number})=>void;onDelete?:()=>void}){const[symbol,setSymbol]=useState('');const[qty,setQty]=useState('');const[cost,setCost]=useState('');useEffect(()=>{if(visible){setSymbol(stock?.symbol||'');setQty(stock?.position?.quantity?String(stock.position.quantity):'');setCost(stock?.position?.averageCost?String(stock.position.averageCost):'')}},[stock,visible]);const submit=()=>{const q=Number(qty),c=Number(cost),sym=symbol.trim();if(!sym||!Number.isFinite(q)||q<=0||!Number.isFinite(c)||c<=0){Alert.alert('資料不完整','股票代碼、股數、成本價都要正確。');return}onSubmit({symbol:sym,quantity:q,averageCost:c})};return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={s.modalBackdrop}><View style={s.modalCard}><Text style={s.cardTitle}>{title}</Text><Text style={s.muted}>現價會自動更新；這裡只修正股票、股數與成本，不會建立買賣成交。</Text><Text style={s.inputLabel}>股票代碼</Text><TextInput value={symbol} onChangeText={setSymbol} autoCapitalize="none" keyboardType="number-pad" style={s.input}/><Text style={s.inputLabel}>股數</Text><TextInput value={qty} onChangeText={setQty} keyboardType="numeric" style={s.input}/><Text style={s.inputLabel}>成本價</Text><TextInput value={cost} onChangeText={setCost} keyboardType="decimal-pad" style={s.input}/>{onDelete?<TouchableOpacity disabled={busy} style={s.deleteBtn} onPress={onDelete}><Text style={s.deleteText}>移除此持股</Text></TouchableOpacity>:null}<View style={s.actionRow}><TouchableOpacity disabled={busy} style={s.ghostBtn} onPress={onClose}><Text style={s.ghostText}>取消</Text></TouchableOpacity><TouchableOpacity disabled={busy} style={s.tradeBtn} onPress={submit}><Text style={s.tradeText}>{busy?'儲存中…':'儲存'}</Text></TouchableOpacity></View></View></View></Modal>}
function CashEditor({visible,value,busy,onClose,onSubmit}:{visible:boolean;value:number;busy:boolean;onClose:()=>void;onSubmit:(n:number)=>void}){const[text,setText]=useState(String(value||0));useEffect(()=>{if(visible)setText(String(value||0))},[visible,value]);const submit=()=>{const n=Number(text);if(!Number.isFinite(n)||n<0){Alert.alert('金額不正確','現金請輸入 0 以上數字。');return}onSubmit(n)};return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={s.modalBackdrop}><View style={s.modalCard}><Text style={s.cardTitle}>修正現金</Text><TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" style={s.input}/><View style={s.actionRow}><TouchableOpacity disabled={busy} style={s.ghostBtn} onPress={onClose}><Text style={s.ghostText}>取消</Text></TouchableOpacity><TouchableOpacity disabled={busy} style={s.tradeBtn} onPress={submit}><Text style={s.tradeText}>{busy?'儲存中…':'儲存'}</Text></TouchableOpacity></View></View></View></Modal>}

function ChatUrlModal({visible,current,onClose,onSave}:{visible:boolean;current:string;onClose:()=>void;onSave:(url:string)=>Promise<void>}){const[url,setUrl]=useState(current);const[busy,setBusy]=useState(false);useEffect(()=>setUrl(current),[current,visible]);async function save(){const x=url.trim();if(!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(x)){Alert.alert('網址看起來不對','請貼你固定股票 ChatGPT 對話的網址。');return}setBusy(true);try{await onSave(x)}finally{setBusy(false)}}return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={s.modalBackdrop}><View style={s.modalCard}><Text style={s.cardTitle}>固定股票 GPT 對話</Text><Text style={s.muted}>這裡是你固定的股票 GPT。正常情況會自動把 App 的資料交給這個 GPT，不需要手動貼資料；只有自動同步真的失敗時才會使用剪貼簿備援。</Text><TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="https://chatgpt.com/c/..." placeholderTextColor={C.muted} style={s.input}/><View style={s.actionRow}><TouchableOpacity disabled={busy} style={s.ghostBtn} onPress={onClose}><Text style={s.ghostText}>取消</Text></TouchableOpacity><TouchableOpacity disabled={busy} style={s.tradeBtn} onPress={save}><Text style={s.tradeText}>{busy?'儲存中…':'儲存'}</Text></TouchableOpacity></View></View></View></Modal>}
function CompactRow({x,onPress}:{x:StockSnapshot;onPress:()=>void}){return <TouchableOpacity style={s.compact} onPress={onPress}><View style={{flex:1}}><Text style={[s.cardTitle,{fontSize:17}]}>{x.name} <Text style={s.code}>{x.symbol}</Text></Text><Text style={s.muted}>{x.nextStep?humanizeTradingText(x.nextStep):stageText(x.setupStage)}</Text></View><View style={{alignItems:'flex-end',marginLeft:8}}><Text style={s.bodyText}>{x.dataTrusted===false||x.dataFresh===false?'—':x.price}</Text><Text style={{color:x.dataTrusted===false||x.dataFresh===false?C.muted:gainColor(x.changePct)}}>{x.dataTrusted===false?'同步中':x.dataFresh===false?'暫停更新':`${x.changePct>=0?'+':''}${x.changePct}%`}</Text></View></TouchableOpacity>}
function Section({title,children}:{title:string;children:React.ReactNode}){return <View style={{marginTop:18}}><Text style={s.section}>{title}</Text>{children}</View>}
function Stat({t,v,c}:{t:string;v:string;c:string}){return <View style={s.stat}><Text style={s.label}>{t}</Text><Text style={[s.statV,{color:c}]}>{v}</Text></View>}
function Empty({text}:{text:string}){return <View style={s.empty}><Text style={s.muted}>{text}</Text></View>}
function Bottom({tab,setTab}:{tab:Tab;setTab:(x:Tab)=>void}){const active:Extract<Tab,'首頁'|'提醒'|'更多'>=tab==='持股'||tab==='監控'?'更多':tab as any;return <View style={s.bottom}>{(['首頁','提醒','更多'] as const).map(x=><TouchableOpacity key={x} style={s.bottomBtn} onPress={()=>setTab(x)}><Text style={{fontSize:20,color:active===x?C.green:C.muted}}>{x==='首頁'?'⌂':x==='提醒'?'◷':'•••'}</Text><Text style={{color:active===x?C.green:C.muted,fontWeight:active===x?'800':'500'}}>{x}</Text></TouchableOpacity>)}</View>}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},body:{flex:1},
 backendError:{backgroundColor:'#2A171B',borderBottomWidth:1,borderBottomColor:'#6A2933',paddingHorizontal:16,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:12},backendOffline:{backgroundColor:'#08131B',borderBottomColor:'#172936',paddingVertical:7},backendErrorTitle:{color:'#FFE5E8',fontSize:13,fontWeight:'900'},backendOfflineTitle:{color:C.muted,fontSize:12},backendErrorSub:{color:'#C7959C',fontSize:11,marginTop:2},backendOfflineSub:{color:'#718395',fontSize:10},backendErrorAction:{color:'#FF9AA5',fontSize:13,fontWeight:'900'},
 scroll:{paddingHorizontal:16,paddingTop:15,paddingBottom:38},title:{fontSize:31,fontWeight:'900',color:C.text,letterSpacing:.1},sub:{fontSize:12,color:C.muted,marginTop:4},code:{fontSize:15,color:'#BBC7D4',fontWeight:'700'},
 statRow:{flexDirection:'row',gap:8},stat:{flex:1,backgroundColor:'#0A151E',borderWidth:1,borderColor:'#192B38',borderRadius:14,paddingHorizontal:11,paddingVertical:10,minHeight:68},statV:{fontSize:24,fontWeight:'900',marginTop:5},label:{fontSize:11,color:C.muted,fontWeight:'700'},
 section:{fontSize:18,color:C.text,fontWeight:'900',marginBottom:9},card:{backgroundColor:C.card,borderRadius:16,borderWidth:1,borderColor:'#1D303D',padding:13,marginBottom:9},cardTitle:{fontSize:20,color:C.text,fontWeight:'900'},price:{fontSize:32,fontWeight:'900',marginTop:4},rowBetween:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},bodyText:{fontSize:14,color:C.text,marginTop:4,fontWeight:'600',lineHeight:20},muted:{color:C.muted,marginTop:3,lineHeight:19},timestamp:{color:'#65788B',fontSize:11,marginTop:7},eventMeta:{color:'#B8C6D3',fontSize:12,fontWeight:'700',marginTop:7},openHint:{color:C.green,fontSize:11,fontWeight:'800',marginTop:8},
 compact:{backgroundColor:'#0A151E',paddingVertical:11,paddingHorizontal:13,borderBottomWidth:1,borderBottomColor:'#182936',flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
 portfolio:{backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:14,padding:13,flexDirection:'row',gap:8},money:{color:C.text,fontSize:16,fontWeight:'900',marginTop:3},notice:{backgroundColor:'#0A151E',borderWidth:1,borderColor:'#1C2D3A',borderRadius:14,padding:13,marginBottom:9},noticeCompact:{backgroundColor:'#08121A',borderWidth:1,borderColor:'#192936',borderRadius:12,paddingHorizontal:12,paddingVertical:10,marginBottom:7},
 inlineWarning:{borderLeftWidth:3,borderLeftColor:C.yellow,paddingLeft:10,marginBottom:10},back:{color:C.muted,fontSize:18,fontWeight:'700'},stockHead:{flexDirection:'row',justifyContent:'space-between',marginTop:12},positionMeta:{color:C.blue,fontSize:13,fontWeight:'800',marginTop:4},
 segment:{flexDirection:'row',backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:11,padding:4,marginVertical:12},segBtn:{flex:1,padding:8,alignItems:'center',borderRadius:8},segOn:{backgroundColor:'#103C2E',borderWidth:1,borderColor:C.green},segText:{color:C.text,fontWeight:'800'},
 bottom:{height:68,borderTopWidth:1,borderTopColor:'#162734',backgroundColor:'#061019',flexDirection:'row',paddingBottom:6},bottomBtn:{flex:1,alignItems:'center',justifyContent:'center',gap:2},
 tradeBtn:{backgroundColor:C.green,borderRadius:10,paddingHorizontal:13,paddingVertical:9},tradeText:{color:'#04100B',fontWeight:'900'},ghostBtn:{flex:1,borderWidth:1,borderColor:C.border,borderRadius:10,paddingHorizontal:12,paddingVertical:9,alignItems:'center'},ghostText:{color:C.muted,fontWeight:'800'},gptBtn:{backgroundColor:'#102D25',borderWidth:1,borderColor:'#287D5D',borderRadius:10,paddingHorizontal:12,paddingVertical:10,alignItems:'center'},gptBtnText:{color:C.green,fontWeight:'900'},actionRow:{flexDirection:'row',gap:8,marginTop:14},
 chartHeader:{flexDirection:'row',justifyContent:'space-between',marginBottom:7},empty:{backgroundColor:'#08121A',borderWidth:1,borderColor:'#172936',borderRadius:12,paddingVertical:13,paddingHorizontal:14,alignItems:'center'},input:{backgroundColor:C.card2,borderWidth:1,borderColor:C.border,borderRadius:10,color:C.text,paddingHorizontal:12,paddingVertical:10,marginVertical:10},
 marketStatusLine:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:4,marginBottom:9},marketStrip:{flexDirection:'row',justifyContent:'space-between',gap:6,marginTop:8,paddingVertical:8,borderTopWidth:1,borderBottomWidth:1,borderColor:C.border},marketStripText:{fontSize:11,color:C.muted,fontWeight:'700'},nextLine:{marginTop:10,paddingTop:9,borderTopWidth:1,borderColor:C.border,flexDirection:'row',gap:8,alignItems:'flex-start'},nextLineLabel:{color:C.green,fontSize:12,fontWeight:'900'},nextLineText:{color:C.text,fontSize:13,fontWeight:'700',flex:1},radarMeta:{color:C.muted,fontSize:12,fontWeight:'700',marginTop:8},
 editMiniBtn:{borderWidth:1,borderColor:'#35516B',borderRadius:9,paddingHorizontal:10,paddingVertical:7,marginLeft:10},editMiniText:{color:C.blue,fontWeight:'900',fontSize:13},inputLabel:{color:C.muted,fontWeight:'800',fontSize:12,marginTop:8},modalBackdrop:{flex:1,backgroundColor:'rgba(0,0,0,.72)',alignItems:'center',justifyContent:'center',padding:20},modalCard:{width:'100%',maxWidth:430,backgroundColor:C.card,borderWidth:1,borderColor:C.border,borderRadius:18,padding:16},
 nightCard:{marginTop:12,backgroundColor:'#0D1A24',borderWidth:1,borderColor:'#2B4B3F',borderRadius:14,padding:12,gap:10},nightCompact:{marginTop:10,backgroundColor:'#091821',borderWidth:1,borderColor:'#1D3A33',borderRadius:13,paddingHorizontal:12,paddingVertical:11,flexDirection:'row',alignItems:'center',gap:10},nightTitle:{color:C.text,fontSize:15,fontWeight:'900'},nightMeta:{color:C.muted,fontSize:12,marginTop:3},nightBtn:{backgroundColor:'#123329',borderWidth:1,borderColor:C.green,borderRadius:10,paddingHorizontal:12,paddingVertical:10,alignItems:'center'},nightBtnText:{color:C.green,fontWeight:'900'},
 headerActions:{flexDirection:'row',gap:6,marginLeft:10},headerGptBtn:{borderWidth:1,borderColor:'#315444',borderRadius:9,paddingHorizontal:10,paddingVertical:7},headerGptText:{color:C.green,fontWeight:'900',fontSize:12},headerApplyBtn:{backgroundColor:'#102D25',borderWidth:1,borderColor:'#287D5D',borderRadius:9,paddingHorizontal:10,paddingVertical:7},headerApplyText:{color:C.green,fontWeight:'900',fontSize:12},ghostMiniBtn:{borderWidth:1,borderColor:C.border,borderRadius:9,paddingHorizontal:10,paddingVertical:7},ghostMiniText:{color:C.text,fontWeight:'800',fontSize:12},editCash:{color:C.blue,fontSize:10,fontWeight:'900'},
 cashWarning:{borderWidth:1,borderColor:'#6A5320',backgroundColor:'#17140C',borderRadius:12,padding:11,marginBottom:10},cashWarningTitle:{color:C.yellow,fontWeight:'900'},assetFormula:{color:C.muted,fontSize:11,marginTop:6},deleteBtn:{marginTop:12,borderWidth:1,borderColor:'#6A2933',borderRadius:10,paddingVertical:9,alignItems:'center'},deleteText:{color:C.red,fontWeight:'900'},
 systemStrip:{flexDirection:'row',flexWrap:'wrap',gap:7,marginBottom:12},statusChip:{backgroundColor:'#09141C',borderWidth:1,borderColor:'#182B37',borderRadius:999,paddingHorizontal:9,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:5},statusDot:{width:7,height:7,borderRadius:4},statusText:{color:'#B5C3D0',fontSize:11,fontWeight:'800'},statusDetail:{fontSize:11,fontWeight:'900'},
 smallAction:{borderWidth:1,borderColor:'#2B3C49',borderRadius:9,paddingHorizontal:10,paddingVertical:7},smallActionGreen:{borderColor:'#287D5D',backgroundColor:'#0D261F'},smallActionYellow:{borderColor:'#66501D',backgroundColor:'#17140C'},smallActionText:{color:C.text,fontSize:12,fontWeight:'900'},
 slimWarning:{marginTop:2,marginBottom:10,borderLeftWidth:3,borderLeftColor:C.yellow,backgroundColor:'#100F0B',borderRadius:9,paddingHorizontal:10,paddingVertical:8},slimWarningTitle:{color:C.yellow,fontSize:12,fontWeight:'900'},slimWarningText:{color:'#9B8E70',fontSize:11,marginTop:2},slimInfo:{backgroundColor:'#08131C',borderRadius:10,paddingHorizontal:11,paddingVertical:8,marginBottom:9},slimInfoText:{color:C.muted,fontSize:12,fontWeight:'700'},
 setupPanel:{backgroundColor:'#111009',borderWidth:1,borderColor:'#56461F',borderRadius:13,padding:12,marginBottom:10,flexDirection:'row',alignItems:'center',gap:10},setupTitle:{color:C.yellow,fontSize:14,fontWeight:'900'},setupSub:{color:'#9F9275',fontSize:11,marginTop:3},setupActions:{gap:6,alignItems:'flex-end'},settingsLine:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10,paddingHorizontal:2},settingsLineText:{color:C.muted,fontSize:11,flex:1},settingsEdit:{color:C.blue,fontSize:11,fontWeight:'900',marginLeft:10},
 assetHero:{backgroundColor:'#0A151E',borderWidth:1,borderColor:'#1D303D',borderRadius:16,padding:14},assetMain:{paddingBottom:12,borderBottomWidth:1,borderBottomColor:'#172936'},assetValue:{color:C.text,fontSize:28,fontWeight:'900',marginTop:4},assetSplit:{flexDirection:'row',gap:16,paddingTop:11},assetSubValue:{color:C.text,fontSize:16,fontWeight:'900',marginTop:4},
 homeHeroCalm:{backgroundColor:'#09141C',borderWidth:1,borderColor:'#172936',borderRadius:22,paddingHorizontal:20,paddingVertical:32,alignItems:'center',marginTop:6},calmIcon:{width:42,height:42,borderRadius:21,textAlign:'center',textAlignVertical:'center',paddingTop:8,color:C.green,backgroundColor:'#0D2B22',fontSize:20,fontWeight:'900'},homeCalmTitle:{color:C.text,fontSize:23,fontWeight:'900',marginTop:16,textAlign:'center'},homeCalmSub:{color:C.muted,fontSize:13,lineHeight:20,marginTop:7,textAlign:'center'},homeHeroActive:{backgroundColor:'#0B181D',borderWidth:1,borderColor:'#285743',borderRadius:22,padding:18,marginTop:6},homeHeroClose:{backgroundColor:'#0A171E',borderWidth:1,borderColor:'#234237',borderRadius:22,padding:20,marginTop:6},homeEyebrow:{color:C.green,fontSize:12,fontWeight:'900',letterSpacing:.4},homeStock:{color:C.text,fontSize:22,fontWeight:'900',marginTop:12},homePrice:{color:C.text,fontSize:38,fontWeight:'900',marginTop:4},homeReason:{color:C.text,fontSize:15,fontWeight:'700',lineHeight:22,marginTop:10},homeMeta:{color:C.muted,fontSize:12,marginTop:8},primaryCta:{backgroundColor:C.green,borderRadius:14,paddingVertical:14,alignItems:'center',marginTop:18},primaryCtaText:{color:'#04100B',fontSize:16,fontWeight:'900'},secondaryLine:{marginTop:12,backgroundColor:'#08131B',borderWidth:1,borderColor:'#172936',borderRadius:14,paddingHorizontal:15,paddingVertical:14,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},secondaryLineTitle:{color:C.text,fontSize:14,fontWeight:'800'},secondaryLineArrow:{color:C.muted,fontSize:26,fontWeight:'400'},closeTitle:{color:C.text,fontSize:24,fontWeight:'900',marginTop:10},closeMiniGrid:{flexDirection:'row',gap:7,marginTop:11},closeMini:{flex:1,backgroundColor:'#08131B',borderWidth:1,borderColor:'#172936',borderRadius:12,paddingHorizontal:10,paddingVertical:10},closeMiniValue:{color:C.text,fontSize:20,fontWeight:'900',marginTop:5},monitorCard:{backgroundColor:C.card,borderWidth:1,borderColor:'#1D303D',borderRadius:16,padding:14,marginTop:9},monitorBadge:{color:C.green,fontSize:11,fontWeight:'900',backgroundColor:'#0D2B22',paddingHorizontal:8,paddingVertical:4,borderRadius:999},monitorState:{color:C.muted,fontSize:12,fontWeight:'700',marginTop:5},monitorNext:{color:C.text,fontSize:14,fontWeight:'700',lineHeight:20,marginTop:10},monitorMetaRow:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:10},monitorMeta:{color:C.muted,fontSize:11,fontWeight:'800'},menuRow:{backgroundColor:'#09141C',borderWidth:1,borderColor:'#172936',borderRadius:15,paddingHorizontal:15,paddingVertical:14,marginBottom:9,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},menuTitle:{color:C.text,fontSize:16,fontWeight:'900'},menuSub:{color:C.muted,fontSize:12,lineHeight:18,marginTop:3},fallbackRow:{marginTop:18,paddingVertical:12,paddingHorizontal:2},fallbackTitle:{color:C.muted,fontSize:13,fontWeight:'800'},systemHistory:{backgroundColor:'#08131B',borderRadius:12,padding:12}
});

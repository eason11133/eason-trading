import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { registerDevice } from './api';

Notifications.setNotificationHandler({handleNotification:async()=>({shouldPlaySound:false,shouldSetBadge:false,shouldShowBanner:true,shouldShowList:true})});

export type PushSetupResult={
 ok:boolean;
 reason:'READY'|'PERMISSION_DENIED'|'PROJECT_ID_MISSING'|'EXPO_GO_NO_REMOTE_PUSH'|'TOKEN_FAILED';
 token?:string;
 projectId?:string;
 error?:string;
};

export async function configurePush():Promise<PushSetupResult>{
 try{
  // Expo Go on Android cannot obtain remote push tokens on SDK 53+. Keep the app usable
  // and reserve remote push registration for the EAS preview/standalone build.
  if(Platform.OS==='android'&&Constants.appOwnership==='expo')return {ok:false,reason:'EXPO_GO_NO_REMOTE_PUSH'};
  if(Platform.OS==='android'){
   await Notifications.setNotificationChannelAsync('radar',{name:'雷達訊號',importance:Notifications.AndroidImportance.HIGH,vibrationPattern:[0,180,120,180]});
   await Notifications.setNotificationChannelAsync('risk',{name:'持股風險',importance:Notifications.AndroidImportance.MAX,vibrationPattern:[0,300,120,300]});
  }
  const existing=await Notifications.getPermissionsAsync();
  let status=existing.status;
  if(status!=='granted')status=(await Notifications.requestPermissionsAsync()).status;
  if(status!=='granted')return {ok:false,reason:'PERMISSION_DENIED'};
  const projectId=String(Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? '');
  if(!projectId)return {ok:false,reason:'PROJECT_ID_MISSING'};
  const token=(await Notifications.getExpoPushTokenAsync({projectId})).data;
  await registerDevice(token,Platform.OS);
  return {ok:true,reason:'READY',token,projectId};
 }catch(e:any){
  return {ok:false,reason:'TOKEN_FAILED',error:e?.message||String(e)};
 }
}

export type PushOpenData={alertId?:string;symbol?:string;type?:string;level?:string;triggerEventId?:string;snapshotId?:string;closePackageId?:string;cloudEventUrl?:string;stockChatUrl?:string};
let lastResponseKey='';
export function subscribeNotificationResponses(onOpen:(data:PushOpenData)=>void){
 const handle=(response:any)=>{try{const key=String(response?.notification?.request?.identifier||response?.actionIdentifier||'');if(key&&key===lastResponseKey)return;if(key)lastResponseKey=key;onOpen((response?.notification?.request?.content?.data||{}) as PushOpenData)}catch{}};
 const sub=Notifications.addNotificationResponseReceivedListener(handle);
 Notifications.getLastNotificationResponseAsync().then(x=>{if(x)handle(x)}).catch(()=>{});
 return ()=>sub.remove();
}

import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Keyboard,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {claimPairing} from '../api';
import {getConnection,initializeConnection} from '../connection';

export function PairingModal({visible,onClose,onPaired}:{visible:boolean;onClose:()=>void;onPaired:()=>Promise<void>|void}){
 const[url,setUrl]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const scrollRef=useRef<ScrollView>(null),codeRef=useRef<TextInput>(null),activeField=useRef<'url'|'code'|null>(null);
 useEffect(()=>{if(!visible)return;initializeConnection().then(()=>setUrl(getConnection().apiUrl)).catch(()=>{});setCode('');setError('')},[visible]);
 const reveal=(where:'top'|'end')=>requestAnimationFrame(()=>where==='end'?scrollRef.current?.scrollToEnd({animated:true}):scrollRef.current?.scrollTo({y:0,animated:true}));
 useEffect(()=>{if(!visible)return;const event=Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow';const sub=Keyboard.addListener(event,()=>reveal(activeField.current==='code'?'end':'top'));return()=>sub.remove()},[visible]);
 const pair=async()=>{if(busy||code.length!==6)return;Keyboard.dismiss();setBusy(true);setError('');try{await claimPairing(url,code);await onPaired();onClose()}catch(e:any){setError(e?.message||'配對失敗');reveal('end')}finally{setBusy(false)}};
 return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
  <SafeAreaView style={s.safe} edges={['top','right','bottom','left']}>
   <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessibilityRole="button" accessibilityLabel="收起鍵盤"/>
   <KeyboardAvoidingView style={s.avoider} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={0}>
    <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={false}>
     <View style={s.card}>
      <Text style={s.title}>連接你的電腦</Text>
      <Text style={s.help}>首次設定需要與電腦配對一次。完成後，即使電腦關機，手機仍可使用雲端監控與提交操作。</Text>
      <Text style={s.step}>1　Backend 位址</Text>
      <TextInput style={s.input} value={url} onChangeText={setUrl} onFocus={()=>{activeField.current='url';reveal('top')}} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={()=>codeRef.current?.focus()} placeholder="192.168.1.23:8787" placeholderTextColor="#64788B"/>
      <Text style={s.step}>2　6 位配對碼</Text>
      <TextInput ref={codeRef} style={[s.input,s.code]} value={code} onChangeText={x=>setCode(x.replace(/\D/g,'').slice(0,6))} onFocus={()=>{activeField.current='code';reveal('end')}} keyboardType="number-pad" inputMode="numeric" returnKeyType="done" onSubmitEditing={pair} maxLength={6} placeholder="123456" placeholderTextColor="#64788B"/>
      {error?<Text style={s.error}>{error}</Text>:null}
      <Text style={s.step}>3　連線配對</Text>
      <View style={s.row}><TouchableOpacity style={s.cancel} onPress={()=>{Keyboard.dismiss();onClose()}} disabled={busy}><Text style={s.cancelText}>取消</Text></TouchableOpacity><TouchableOpacity style={[s.ok,(busy||code.length!==6)&&s.disabled]} onPress={pair} disabled={busy||code.length!==6}>{busy?<ActivityIndicator color="#07110D"/>:<Text style={s.okText}>連線／配對</Text>}</TouchableOpacity></View>
     </View>
    </ScrollView>
   </KeyboardAvoidingView>
  </SafeAreaView>
 </Modal>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:'rgba(0,0,0,.76)'},avoider:{flex:1},scroll:{flex:1},scrollContent:{flexGrow:1,justifyContent:'center',alignItems:'center',paddingHorizontal:20,paddingVertical:16},card:{width:'100%',maxWidth:430,backgroundColor:'#0B1620',borderWidth:1,borderColor:'#20303E',borderRadius:18,padding:18},title:{color:'#F4F7FA',fontSize:20,fontWeight:'900'},help:{color:'#8DA0B4',fontSize:13,lineHeight:19,marginTop:8,marginBottom:10},step:{color:'#8DA0B4',fontSize:12,fontWeight:'800',marginTop:10,marginBottom:5},input:{borderWidth:1,borderColor:'#2A3A49',borderRadius:10,paddingHorizontal:12,paddingVertical:11,color:'#F4F7FA',backgroundColor:'#08121A'},code:{fontSize:22,letterSpacing:5,textAlign:'center'},error:{color:'#FF5B67',fontSize:12,marginTop:10},row:{flexDirection:'row',gap:10},cancel:{flex:1,borderWidth:1,borderColor:'#2A3A49',borderRadius:10,paddingVertical:11,alignItems:'center'},cancelText:{color:'#F4F7FA',fontWeight:'800'},ok:{flex:1,backgroundColor:'#35D99A',borderRadius:10,paddingVertical:11,alignItems:'center'},disabled:{opacity:.5},okText:{color:'#07110D',fontWeight:'900'}});

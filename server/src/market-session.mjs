const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

export function taipeiParts(date=new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return { weekday:p.weekday, year:Number(p.year), month:Number(p.month), day:Number(p.day), hour:Number(p.hour), minute:Number(p.minute), second:Number(p.second) };
}

export function marketSession(date=new Date()) {
  const p=taipeiParts(date);
  const weekend=['Sat','Sun'].includes(p.weekday);
  const minutes=p.hour*60+p.minute;
  let session='CLOSED';
  if(weekend) session='WEEKEND';
  else if(minutes<8*60+30) session='PREMARKET';
  else if(minutes<9*60) session='PREOPEN';
  else if(minutes<=13*60+30) session='OPEN';
  else session='CLOSED';
  return { timeZone:'Asia/Taipei',session,isOpen:session==='OPEN',taipei:p };
}

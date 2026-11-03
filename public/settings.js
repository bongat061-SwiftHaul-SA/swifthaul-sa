import {getUser,updateUser,logout} from 'https://esm.sh/@netlify/identity@2.0.0?bundle';
const status=document.getElementById('settings-status');
const content=document.getElementById('settings-content');
const profile=document.getElementById('profile-form');
const picture=document.getElementById('profile-photo');
let epoch=0,photoURL,loaded=false;
function report(text){status.textContent=text;}
function clear(){epoch++;loaded=false;content.hidden=true;document.querySelectorAll('#settings form').forEach(form=>{form.reset();form.hidden=false;});document.getElementById('bank-fields').disabled=true;picture.hidden=true;picture.removeAttribute('src');if(photoURL) URL.revokeObjectURL(photoURL);photoURL=null;report('');}
function authenticated(){return document.body.dataset.guestPreview!=='true' && !document.getElementById('workspace').hidden;}
async function api(options={}){
  if(!authenticated() || !(await getUser())) throw new Error('Sign in to manage customer settings.');
  const response=await fetch('/api/customer-profile'+(options.photo?'?photo':''),{cache:'no-store',...options});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error || 'Unable to load customer settings.');}
  return options.photo && !options.method ? response.blob() : response.json();
}
async function load(){
  if(!authenticated()){report('Sign in to manage customer settings.');return;}
  const version=++epoch;content.hidden=true;loaded=false;report('Loading your settings…');
  try{
    const result=await api();if(version!==epoch)return;
    const data=result.profile || {};
    document.querySelectorAll('#settings-content form').forEach(form=>form.hidden=!!result.deletion_pending && form.id!=='delete-profile-form');
    if(result.deletion_pending){loaded=true;content.hidden=false;report('Deletion is pending. Type DELETE below to retry finishing account deletion.');return;}
    profile.reset();document.getElementById('bank-fields').disabled=true;
    for(const key of ['full_name','phone','details']) profile.elements[key].value=data[key] || '';
    document.getElementById('bank-summary').textContent=data.bank_last_four ? `${data.bank_name} · Account ending ${data.bank_last_four}` : 'No banking details saved.';
    loaded=true;content.hidden=false;report('');
    if(photoURL) URL.revokeObjectURL(photoURL);photoURL=null;picture.hidden=true;
    const response=await fetch('/api/customer-profile?photo',{cache:'no-store'});
    if(version!==epoch)return;
    if(response.ok){const blob=await response.blob();if(version!==epoch)return;photoURL=URL.createObjectURL(blob);picture.src=photoURL;picture.hidden=false;}
  }catch(error){if(version===epoch) report(error.message);}
}
document.getElementById('load-settings').addEventListener('click',load);
profile.elements.replace_bank.addEventListener('change',()=>{document.getElementById('bank-fields').disabled=!profile.elements.replace_bank.checked;});
function action(form,handler){form.addEventListener('submit',async event=>{
  event.preventDefault();if(!loaded || !authenticated())return;
  const version=epoch,button=form.querySelector('[type=submit]');button.disabled=true;report('Saving…');
  try{await handler(version);}
  catch(error){if(version===epoch)report(error.message || 'Unable to save. Retry.');}
  finally{button.disabled=false;}
});}
action(profile,async version=>{
  const data=Object.fromEntries(new FormData(profile));
  for(const key of ['bank_name','account_holder','account_number','branch_code']) data[key]=data[key] || '';
  data.replace_bank=profile.elements.replace_bank.checked;
  await api({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  if(version!==epoch)return;await load();report('Profile details saved.');
});
action(document.getElementById('password-form'),async version=>{
  const form=document.getElementById('password-form');
  if(form.elements.password.value!==form.elements.confirmation.value) throw new Error('Passwords must match.');
  if(!(await getUser()))throw new Error('Sign in again to change your password.');
  await updateUser({password:form.elements.password.value});
  if(version!==epoch)return;form.reset();report('Password updated.');
});
action(document.getElementById('photo-form'),async version=>{
  const file=document.getElementById('photo-form').elements.photo.files[0];
  if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>8*1024*1024)throw new Error('Choose a JPEG, PNG or WebP smaller than 8 MB.');
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(1,800/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));
  if(!blob)throw new Error('Unable to process this picture. Try a different image.');
  if(version!==epoch)return;
  await api({photo:true,method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});
  if(version!==epoch)return;document.getElementById('photo-form').reset();await load();report('Picture uploaded.');
});
action(document.getElementById('delete-profile-form'),async version=>{
  await api({method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:document.getElementById('delete-profile-form').elements.confirmation.value})});
  if(version!==epoch)return;clear();document.dispatchEvent(new Event('account-cleared'));await logout().catch(()=>{});window.location.replace('/');
});
document.addEventListener('account-ready',()=>{if(!loaded)load();});
document.addEventListener('account-cleared',clear);
document.addEventListener('guest-preview',()=>{clear();report('Guest preview: sign in to manage your customer settings.');});

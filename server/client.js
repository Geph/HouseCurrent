async function serverAPI(action,body){
 const response=await fetch('api.php?action='+encodeURIComponent(action),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json','X-CSRF-Token':serverCSRF},body:JSON.stringify(body)}:{})})
 let result;try{result=await response.json()}catch{throw Error('Invalid server response. Your change was not confirmed saved.')}
 if(!response.ok)throw Error(result.error||'Server request failed. Your change was not confirmed saved.')
 return result
}
const authButton=$('#server-auth')
authButton.textContent=READ_ONLY?'Sign in to edit':'Sign out'
if(!READ_ONLY)$('.local-note').innerHTML='<div>Editing household<small>Changes are saved on the server.</small></div>'
authButton.addEventListener('click',async()=>{
 if(!READ_ONLY){try{await serverAPI('logout',{});location.reload()}catch(error){toast(error.message)}return}
 modal('Sign in to edit','Viewing stays public. Editing requires your household password.',field('Password','password','password','','required autocomplete="current-password" maxlength="72"'),'Sign in','server-login')
 $('#active-form').addEventListener('submit',async event=>{
  event.preventDefault();event.stopImmediatePropagation()
  const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true
  try{await serverAPI('login',{password:new FormData(form).get('password')});location.reload()}
  catch(error){$('#form-error').textContent=error.message;button.disabled=false}
 })
})
// Refresh viewers without interrupting an open sign-in dialog or an editor's unsaved form.
setInterval(async()=>{
 if(!READ_ONLY||document.hidden||$('#modal').open)return
 try{const latest=await serverAPI('state');serverCSRF=latest.csrf;if(latest.editable){location.reload();return}if(latest.revision!==serverRevision){state=validateState(latest.state);serverRevision=latest.revision;render()}}
 catch{$('#save-state').textContent='Connection issue · retrying'}
},30000)

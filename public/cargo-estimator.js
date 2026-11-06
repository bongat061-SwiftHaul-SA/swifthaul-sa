(() => {
  const form=document.getElementById('booking-form');
  const parcel=form?.querySelector('.parcel-fields');
  if(!form||!parcel||document.getElementById('cargo-estimator'))return;
  const style=document.createElement('style');
  style.textContent='#cargo-estimator{margin:14px 0;padding:16px;border:1px solid #d5e0d7;border-radius:14px;background:#f8faf7}#cargo-estimator h3{margin:0 0 6px;color:#173d31;font-size:16px}#cargo-estimator p{font-size:12px;line-height:1.55;color:#60736a}#cargo-estimator label{display:block;margin:10px 0 5px;font-size:12px;font-weight:700}#cargo-estimator textarea,#cargo-estimator input[type=file]{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cbd8ce;border-radius:9px;background:#fff}#cargo-estimator .cargo-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}#cargo-estimator button{border:0;border-radius:9px;padding:11px 14px;background:#1c5b43;color:#fff;font-weight:800;cursor:pointer}#cargo-estimator button:disabled{opacity:.55;cursor:wait}#cargo-estimator .cargo-result{margin-top:12px;padding:12px;border-radius:10px;background:#fff;border:1px solid #dbe4dc}#cargo-estimator .cargo-result[hidden]{display:none}#cargo-estimator .cargo-range{font-size:17px;font-weight:800;color:#173d31}#cargo-estimator .cargo-disclaimer{font-size:11px;color:#805b20}';
  document.head.append(style);
  const panel=document.createElement('section');panel.id='cargo-estimator';
  panel.innerHTML='<h3>Estimate your load with a photo or description</h3><p>Take a photo of your items or describe them. AI will suggest packed dimensions and a weight range.</p><label for="cargo-photo">Take or upload an item photo (optional)</label><input id="cargo-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"><label for="cargo-description">What are you transporting?</label><textarea id="cargo-description" rows="3" maxlength="1200" placeholder="e.g. one 2-seater couch, two moving boxes and a small fridge"></textarea><p>For better size estimates, photograph the whole item beside a ruler or standard-size reference. Avoid faces and personal documents.</p><div class="cargo-actions"><button type="button" id="cargo-estimate">Estimate my items</button></div><p id="cargo-status" role="status" aria-live="polite"></p><div id="cargo-result" class="cargo-result" hidden><div class="cargo-range" id="cargo-weight-range"></div><p id="cargo-dimensions"></p><p id="cargo-items"></p><p class="cargo-disclaimer">A photo cannot measure actual mass. AI estimates may be wrong. Confirm actual weight using a scale or reliable specification before booking.</p><div class="cargo-actions"><button type="button" id="cargo-apply-dimensions">Use estimated dimensions</button></div></div>';
  parcel.append(panel);
  const $=id=>document.getElementById(id);
  let lastEstimate=null;
  async function compress(file){
    if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('Choose a JPG, PNG or WEBP image.');
    if(file.size>12*1024*1024)throw new Error('Choose an image smaller than 12 MB.');
    const bitmap=await createImageBitmap(file),scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d',{alpha:false}).drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
    return canvas.toDataURL('image/jpeg',0.78);
  }
  $('cargo-estimate').addEventListener('click',async()=>{
    const description=$('cargo-description').value.trim(),file=$('cargo-photo').files?.[0],button=$('cargo-estimate');
    if(!description&&!file){$('cargo-status').textContent='Add a description or choose a photo first.';return;}
    button.disabled=true;$('cargo-result').hidden=true;
    try{
      const client=window.swiftHaulSupabase;if(!client)throw new Error('Please sign in to use the secure cargo estimator.');
      const image_data_url=file?await compress(file):null;
      $('cargo-status').textContent='Estimating your load…';
      const result=await client.functions.invoke('cargo-estimator',{body:{description,image_data_url}});
      if(result.error)throw new Error(result.data?.error||result.error.message||'Estimator unavailable.');
      if(result.data?.error)throw new Error(result.data.error);
      const estimate=result.data?.estimate;if(!estimate?.dimensions_cm||!estimate?.weight_kg_range)throw new Error('Incomplete estimate. Please enter details manually.');
      lastEstimate=estimate;
      $('cargo-weight-range').textContent='Estimated total weight: '+Number(estimate.weight_kg_range.min).toFixed(1)+'–'+Number(estimate.weight_kg_range.max).toFixed(1)+' kg';
      const d=estimate.dimensions_cm;
      $('cargo-dimensions').textContent='Suggested packed dimensions: '+Math.round(d.length)+' cm L × '+Math.round(d.width)+' cm W × '+Math.round(d.height)+' cm H';
      $('cargo-items').textContent=Array.isArray(estimate.items)?'Identified items: '+estimate.items.map(x=>(x.quantity||1)+' × '+x.name).join(', '):'';
      $('cargo-result').hidden=false;$('cargo-status').textContent='Estimate ready. Review it before applying dimensions.';
    }catch(error){$('cargo-status').textContent=error instanceof Error?error.message:'Could not estimate this load. Please enter details manually.';}
    finally{button.disabled=false;}
  });
  $('cargo-apply-dimensions').addEventListener('click',()=>{
    if(!lastEstimate?.dimensions_cm)return;
    for(const key of ['length','width','height']){const input=form.elements.namedItem(key);if(input)input.value=String(Math.max(0.1,Number(lastEstimate.dimensions_cm[key])));}
    form.dispatchEvent(new Event('input',{bubbles:true}));form.dispatchEvent(new Event('change',{bubbles:true}));
    $('cargo-status').textContent='Estimated dimensions applied. Enter and confirm the actual weight separately.';
    form.elements.namedItem('weight')?.focus();
  });
})();
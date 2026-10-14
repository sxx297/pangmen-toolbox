using System;
using System.Collections.Generic;
using System.Globalization;
namespace Pangmen.Motion {
    public static class NativeTrackWriter {
        public static int[] Compact(float[] times, object[] values, int propertyId) {
            var result = new SortedSet<int> { 0, times.Length - 1 };
            if(times.Length <= 2 || propertyId == 101 || propertyId == 1005) { var all = new int[times.Length]; for(int i=0;i<all.Length;i++)all[i]=i;return all; }
            var numeric = new double[values.Length]; string prefix = null;
            for(int i=0;i<values.Length;i++) {
                var text=values[i] as string;
                if(text!=null) {
                    int offset=text.StartsWith("#ppt_") ? 6 : 0;
                    if(offset>0 && text.Length>offset && text[offset]=='*')offset++;
                    var head=text.Substring(0,offset);
                    if(prefix!=null && prefix!=head)throw new ArgumentException("Inconsistent animation expressions");
                    prefix=head;numeric[i]=Double.Parse(text.Substring(offset),CultureInfo.InvariantCulture);
                } else numeric[i]=Convert.ToDouble(values[i]);
            }
            double tolerance=propertyId==6 ? .1 : prefix!=null && prefix.EndsWith("*") ? .001 : .0002;
            var spans=new Stack<Tuple<int,int>>();spans.Push(Tuple.Create(0,times.Length-1));
            while(spans.Count>0) {
                var span=spans.Pop();int first=span.Item1,last=span.Item2,index=-1;double largest=tolerance;
                for(int i=first+1;i<last;i++) {
                    double expected=numeric[first]+(numeric[last]-numeric[first])*(times[i]-times[first])/(times[last]-times[first]);
                    double error=Math.Abs(numeric[i]-expected);if(error>largest){largest=error;index=i;}
                }
                if(index>=0){result.Add(index);spans.Push(Tuple.Create(first,index));spans.Push(Tuple.Create(index,last));}
            }
            var kept=new int[result.Count];result.CopyTo(kept);return kept;
        }
        // Keep the chatty point loop in managed code rather than PowerShell's COM adapter.
        public static object AddProperty(object effectObject, int propertyId, float[] times, object[] values, bool smooth) {
            dynamic effect = effectObject;
            float duration = (float)effect.Timing.Duration;
            dynamic behavior = effect.Behaviors.Add(5);
            behavior.Timing.Duration = duration;
            dynamic property = behavior.PropertyEffect;
            property.Property = propertyId;
            dynamic points = property.Points;
            points.Smooth = smooth ? -1 : 0;
            foreach (int i in Compact(times, values, propertyId)) {
                dynamic point = points.Add();
                point.Time = times[i];
                if (values[i] is string) point.Value = (string)values[i];
                else if (propertyId == 101 || propertyId == 1005) point.Value = Convert.ToInt32(values[i]);
                else point.Value = Convert.ToSingle(values[i]);
            }
            return behavior;
        }
    }
}
